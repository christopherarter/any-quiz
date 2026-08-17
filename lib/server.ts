import { existsSync, readFileSync, statSync } from 'node:fs'
import {
  createServer as httpCreateServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { extname, join, normalize } from 'node:path'
import { DIST_DIR } from './buildinfo.ts'
import { loadFull, loadPublic, readAnswers, writeAnswers } from './quiz.ts'
import type { Meta, ResponseEntry } from './types.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const JSON_MIME = 'application/json; charset=utf-8'

const OK = 200
const NO_CONTENT = 204
const BAD_REQUEST = 400
const NOT_FOUND = 404
const METHOD_NOT_ALLOWED = 405
const INTERNAL_ERROR = 500

const MAX_BODY = 1_000_000

const LEADING_DOTDOT_RE = /^(\.\.[/\\])+/

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': JSON_MIME,
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function serveStatic(res: ServerResponse, urlPath: string): void {
  const path = resolveDistPath(urlPath)
  if (path === null) {
    sendText(res, BAD_REQUEST, 'bad path')
    return
  }
  if (!(existsSync(path) && statSync(path).isFile())) {
    sendText(res, NOT_FOUND, 'not found')
    return
  }
  res.writeHead(OK, {
    'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  })
  res.end(readFileSync(path))
}

// Stops buffering once the body exceeds MAX_BODY -- memory stays bounded regardless of
// how large the client's body actually is -- but does NOT reject as soon as that happens.
// The `data` listener already put the stream in flowing mode, so it keeps draining
// (and discarding) the remainder even after buffering stops; we wait for `end` before
// settling the promise either way. Responding (or destroying the socket) while the
// client is still uploading causes the OS to send a TCP RST for the unread remainder on
// close, which the client sees as a transport error ("fetch failed") instead of a
// readable 400 -- and that failure mode is size- and timing-dependent, so a body only
// slightly over the cap can look "fixed" while a multi-megabyte body still races. Only
// settling after the whole request has genuinely ended means the client's upload always
// completes normally and it always gets a real status code, at any oversized body size.
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let tooLarge = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) {
        return
      }
      size += chunk.length
      if (size > MAX_BODY) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        reject(new Error('body too large'))
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

// Groups the per-server state each request handler needs so those handlers stay under
// the project's max-parameters limit instead of threading `dir`, `meta`, `questionIds`,
// and `known` through individually.
interface QuizContext {
  dir: string
  meta: Meta
  questionIds: string[]
  known: Set<string>
}

async function handlePutAnswers(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: QuizContext,
): Promise<void> {
  let body: string
  try {
    body = await readBody(req)
  } catch {
    // By the time this rejects, `readBody` has already drained the full request (see
    // its comment), so the connection is left in a normal state and safely reusable.
    sendJson(res, BAD_REQUEST, { error: 'body too large' })
    return
  }
  let patch: { responses?: Record<string, ResponseEntry> }
  try {
    patch = JSON.parse(body)
  } catch {
    sendJson(res, BAD_REQUEST, { error: 'malformed JSON body' })
    return
  }
  const incoming = patch.responses
  if (!incoming || typeof incoming !== 'object') {
    sendJson(res, BAD_REQUEST, { error: 'body must be {responses: {...}}' })
    return
  }
  const unknown = Object.keys(incoming).filter((id) => !ctx.known.has(id))
  if (unknown.length > 0) {
    sendJson(res, BAD_REQUEST, { error: `unknown question ids: ${unknown.join(', ')}` })
    return
  }
  const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds)
  for (const [id, entry] of Object.entries(incoming)) {
    answers.responses[id] = {
      value: entry?.value ?? null,
      flagged: entry?.flagged === true,
    }
  }
  writeAnswers(ctx.dir, answers)
  res.writeHead(NO_CONTENT)
  res.end()
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: QuizContext,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')

  if (url.pathname === '/api/quiz' && req.method === 'GET') {
    sendJson(res, OK, loadPublic(ctx.dir))
    return
  }
  if (url.pathname === '/api/answers' && req.method === 'GET') {
    sendJson(res, OK, readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds))
    return
  }
  if (url.pathname === '/api/answers' && req.method === 'PUT') {
    await handlePutAnswers(req, res, ctx)
    return
  }
  if (url.pathname.startsWith('/api/')) {
    sendJson(res, NOT_FOUND, { error: 'unknown endpoint' })
    return
  }
  if (req.method !== 'GET') {
    sendText(res, METHOD_NOT_ALLOWED, 'method not allowed')
    return
  }
  serveStatic(res, url.pathname)
}

// Exported for a direct unit test of the traversal guard. Every real HTTP request
// reaches `serveStatic` only after `new URL(req.url, ...)` has already resolved literal
// and percent-encoded ".." segments, so this function's own containment check is
// effectively unreachable via HTTP alone -- it is exercised in tests with raw,
// unnormalized strings that never pass through URL parsing at all.
export function resolveDistPath(urlPath: string): string | null {
  let target = urlPath
  if (target === '/') {
    target = '/index.html'
  }
  const rel = normalize(target).replace(LEADING_DOTDOT_RE, '')
  const path = join(DIST_DIR, rel)
  if (!path.startsWith(DIST_DIR)) {
    return null
  }
  return path
}

export function createServer({ dir }: { dir: string }): Server {
  const { meta, questions } = loadFull(dir)
  const ctx: QuizContext = {
    dir,
    meta,
    questionIds: questions.map((q) => q.id),
    known: new Set(questions.map((q) => q.id)),
  }

  return httpCreateServer((req, res) => {
    // `handleRequest` is async (it awaits the request body for PUT), so a synchronous
    // call here would leave its returned promise unhandled. Routing errors -- including
    // any thrown before a response is sent -- through this `.catch` (instead of `void`)
    // keeps one bad request from crashing the process while avoiding the banned `void`
    // operator.
    handleRequest(req, res, ctx).catch(() => {
      if (!res.headersSent) {
        sendText(res, INTERNAL_ERROR, 'internal error')
        return
      }
      res.destroy()
    })
  })
}
