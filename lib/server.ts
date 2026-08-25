import type { Server } from 'node:http'
import { createAdaptorServer } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { PutAnswersBodySchema } from './answers-schema.ts'
import { DIST_DIR } from './buildinfo.ts'
import {
  appendHistoryEntry,
  buildFinishPayload,
  loadFull,
  loadPublic,
  readAnswers,
  readHistory,
  skeleton,
  writeAnswers,
} from './quiz.ts'
import { scoreQuiz } from './score.ts'
import type { FinishPayload, Meta, Question, QuizKind, ResultPayload } from './types.ts'

const OK = 200
const NO_CONTENT = 204
const BAD_REQUEST = 400
const NOT_FOUND = 404
const CONFLICT = 409
const MAX_BODY = 1_000_000

interface ValidationIssue {
  path: PropertyKey[]
  message: string
}

// Groups issues by their dotted field path -- the shape used by e.g. Laravel's and ASP.NET
// Core's validation error bags -- so a client (or a test) can tell which field failed
// without parsing prose.
function toErrorBag(issues: ValidationIssue[]): Record<string, string[]> {
  const bag: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.join('.')
    const existing = bag[key]
    if (existing) {
      existing.push(issue.message)
    } else {
      bag[key] = [issue.message]
    }
  }
  return bag
}

// Groups the per-server state each request handler needs so those handlers stay under
// the project's max-parameters limit instead of threading `dir`, `meta`, `questionIds`,
// and `known` through individually.
interface QuizContext {
  dir: string
  meta: Meta
  questions: Question[]
  questionIds: string[]
  known: Set<string>
  kind: QuizKind
  // Number of runs already in history.json before this server started -- everywhere
  // `runs` gets read for reporting purposes, it must be sliced by this so a re-served
  // set folder reports only the current sitting's runs, not every sitting ever run in
  // that folder.
  runsAtStart: number
  // Set once the server object exists, so the submit handler can announce a finished
  // attempt without the handler itself holding a reference to the server.
  emitSubmitted: (payload: ResultPayload) => void
  emitFinished: (payload: FinishPayload) => void
}

function registerAnswers(app: Hono, ctx: QuizContext): void {
  app.get('/api/answers', (c) =>
    c.json(readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.kind), OK),
  )

  app.put(
    '/api/answers',
    bodyLimit({ maxSize: MAX_BODY }),
    zValidator('json', PutAnswersBodySchema, (result, c) => {
      if (!result.success) {
        return c.json(
          { message: 'validation failed', errors: toErrorBag(result.error.issues) },
          BAD_REQUEST,
        )
      }
    }),
    (c) => {
      const { responses: incoming } = c.req.valid('json')
      const unknown = Object.keys(incoming).filter((id) => !ctx.known.has(id))
      if (unknown.length > 0) {
        return c.json({ error: `unknown question ids: ${unknown.join(', ')}` }, BAD_REQUEST)
      }
      const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.kind)
      for (const [id, entry] of Object.entries(incoming)) {
        answers.responses[id] = {
          value: entry.value ?? null,
          flagged: entry.flagged ?? false,
        }
      }
      writeAnswers(ctx.dir, answers)
      return c.body(null, NO_CONTENT)
    },
  )
}

// The server deliberately does NOT exit here. Process lifetime belongs to the CLI, which
// listens for `submitted` and decides what to do; a route handler that called
// `process.exit` would make the server untestable and unusable from anything else.
function registerSubmit(app: Hono, ctx: QuizContext): void {
  app.post('/api/submit', (c) => {
    const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.kind)
    if (answers.status === 'submitted') {
      return c.json({ error: 'this quiz has already been submitted' }, CONFLICT)
    }

    if (ctx.kind === 'set') {
      const { auto, flagged } = scoreQuiz(ctx.questions, answers.responses)
      appendHistoryEntry(ctx.dir, {
        ranAt: new Date().toISOString(),
        correct: auto.correct,
        total: auto.total,
        perQuestion: auto.perQuestion,
        flagged,
      })
      writeAnswers(ctx.dir, skeleton(ctx.meta.id, ctx.questionIds, 'set'))
      return c.json(
        {
          ok: true,
          result: { correct: auto.correct, total: auto.total, perQuestion: auto.perQuestion },
        },
        OK,
      )
    }

    answers.status = 'submitted'
    answers.submittedAt = new Date().toISOString()
    // Persist before scoring and before emitting: a crash after this point still leaves a
    // submitted attempt on disk, whereas emitting first could announce a result that was
    // never durably recorded.
    writeAnswers(ctx.dir, answers)

    const { auto, needsGrading, flagged } = scoreQuiz(ctx.questions, answers.responses)
    // Respond before emitting so a listener cannot act on the payload while the browser is
    // still waiting on its request.
    const response = c.json({ ok: true }, OK)
    ctx.emitSubmitted({
      quizId: ctx.meta.id,
      quizDir: ctx.dir,
      auto,
      needsGrading,
      flagged,
      responses: answers.responses,
    })
    return response
  })
}

function registerFinish(app: Hono, ctx: QuizContext): void {
  let finished = false
  app.post('/api/finish', (c) => {
    if (finished) {
      return c.json({ error: 'this set has already finished' }, CONFLICT)
    }
    finished = true
    const { runs } = readHistory(ctx.dir)
    const response = c.json({ ok: true }, OK)
    ctx.emitFinished(buildFinishPayload(ctx.meta, ctx.dir, runs.slice(ctx.runsAtStart)))
    return response
  })
}

function buildApp(ctx: QuizContext): Hono {
  const app = new Hono()

  app.get('/api/quiz', (c) => c.json(loadPublic(ctx.dir), OK))
  registerAnswers(app, ctx)
  registerSubmit(app, ctx)
  if (ctx.kind === 'set') {
    registerFinish(app, ctx)
  }
  app.all('/api/*', (c) => c.json({ error: 'unknown endpoint' }, NOT_FOUND))
  app.get('*', serveStatic({ root: DIST_DIR }))

  return app
}

export function createServer({ dir }: { dir: string }): Server {
  const { meta, questions } = loadFull(dir)
  // `server` is read inside `emitSubmitted` only once a request actually calls it, well
  // after this function has returned it -- letting `ctx` close over the binding here (and
  // assigning it below) is what lets the submit handler announce completion without
  // holding a reference to the app that built it.
  let server: Server
  const ctx: QuizContext = {
    dir,
    meta,
    questions,
    questionIds: questions.map((q) => q.id),
    known: new Set(questions.map((q) => q.id)),
    kind: meta.kind ?? 'quiz',
    runsAtStart: readHistory(dir).runs.length,
    emitSubmitted: (payload) => {
      server.emit('submitted', payload)
    },
    emitFinished: (payload) => {
      server.emit('finished', payload)
    },
  }
  // `createAdaptorServer`'s return type covers the http2 adapters this project never
  // configures (no `serverOptions`/`createServer` override is passed), so it is always a
  // plain node:http server here, even though the union type doesn't say so.
  server = createAdaptorServer({ fetch: buildApp(ctx).fetch }) as Server
  return server
}
