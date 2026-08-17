#!/usr/bin/env node
import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import process from 'node:process'
import { DIST_DIR, isDistFresh } from './lib/buildinfo.ts'
import { openBrowser } from './lib/open.ts'
import { answersPath, archiveAnswers, loadFull, QuizError, readAnswers } from './lib/quiz.ts'
import { createServer } from './lib/server.ts'
import type { Meta, Question, ResultPayload } from './lib/types.ts'

const EXIT_OK = 0
const EXIT_BAD_INPUT = 2
const EXIT_ABANDONED = 3
const MAX_PORT = 65_535
const JSON_INDENT = 2

const USAGE = 'usage: serve.ts <quiz-dir> [--port N] [--no-open] [--retake]'

// Everything human-readable goes to stderr so stdout carries exactly one thing: the
// result payload. The calling session parses stdout, so a stray banner there would be a
// parse error rather than cosmetic noise.
function log(msg: string): void {
  process.stderr.write(`${msg}\n`)
}

function fail(message: string, errors: string[] = []): never {
  log(`any-quiz: ${message}`)
  for (const e of errors) {
    log(`  - ${e}`)
  }
  process.exit(EXIT_BAD_INPUT)
}

// Exits only once the server has actually stopped, so the in-flight submit response is
// allowed to finish and the browser never sees a torn request at the moment it submits.
// `close()` also drops idle keep-alive sockets on its own (Node >= 19, and package.json
// requires >= 22.18) -- a browser always leaves some behind, and without that the callback
// would never fire and the process would hang instead of handing control back to the
// session. `closeIdleConnections()` was tried here and removed: with a raw idle socket
// held open on purpose (see test/cli.test.ts) the exit is clean without it.
function shutdown(server: Server, code: number): void {
  server.close(() => {
    process.exit(code)
  })
}

function resolveOptions(argv: string[]): Options & { dir: string } {
  const opts = parseArgs(argv)
  if (opts.dir === null) {
    fail(USAGE)
  }
  if (!(Number.isInteger(opts.port) && opts.port >= 0 && opts.port <= MAX_PORT)) {
    fail(`--port must be an integer between 0 and ${MAX_PORT}`)
  }
  return { ...opts, dir: opts.dir }
}

function loadQuiz(dir: string, retake: boolean): { meta: Meta; questions: Question[] } {
  let loaded: { meta: Meta; questions: Question[] }
  try {
    loaded = loadFull(dir)
  } catch (err) {
    if (err instanceof QuizError) {
      fail(err.message, err.errors)
    }
    throw err
  }

  if (!existsSync(answersPath(dir))) {
    return loaded
  }
  const ids = loaded.questions.map((q) => q.id)
  if (readAnswers(dir, loaded.meta.id, ids).status !== 'submitted') {
    return loaded
  }
  if (!retake) {
    fail('this quiz was already submitted; pass --retake to start a fresh attempt')
  }
  // Archived rather than overwritten: a finished attempt is the record the session
  // coached against, so a retake must not destroy it.
  log(`any-quiz: archived the previous attempt to ${archiveAnswers(dir)}`)
  return loaded
}

function announce(server: Server, meta: Meta, questionCount: number, open: boolean): void {
  const address = server.address()
  if (address === null || typeof address === 'string') {
    return
  }
  const url = `http://127.0.0.1:${address.port}`
  log(`any-quiz: ${meta.title} — ${questionCount} questions`)
  log(`any-quiz: ${url}`)
  if (open && !openBrowser(url)) {
    log('any-quiz: could not launch a browser; open the URL above')
  }
}

function main(): void {
  const opts = resolveOptions(process.argv.slice(2))

  if (!existsSync(DIST_DIR)) {
    fail('the frontend bundle is missing — run `npm run build`')
  }
  if (!isDistFresh()) {
    log('any-quiz: warning — app/dist is stale; run `npm run build`')
  }

  const { meta, questions } = loadQuiz(opts.dir, opts.retake)
  const server = createServer({ dir: opts.dir })

  server.on('submitted', (payload: ResultPayload) => {
    process.stdout.write(`${JSON.stringify(payload, null, JSON_INDENT)}\n`)
    shutdown(server, EXIT_OK)
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      log('any-quiz: abandoned; the draft is saved and the quiz can be re-served')
      shutdown(server, EXIT_ABANDONED)
    })
  }

  server.on('error', (err: NodeJS.ErrnoException) => {
    // A requested port is a convenience, not a requirement, so a busy one degrades to an
    // ephemeral port instead of aborting. The listen callback below was registered as a
    // one-shot `listening` listener that never fired, so it is still attached and the
    // banner still prints after the retry succeeds.
    if (err.code === 'EADDRINUSE' && opts.port !== 0) {
      log(`any-quiz: port ${opts.port} is busy, falling back to an ephemeral port`)
      server.listen(0, '127.0.0.1')
      return
    }
    fail(err.message)
  })

  // Bound to the loopback interface, never 0.0.0.0: the quiz exposes a submit endpoint
  // and the grading results derived from the answer key, and none of that should be
  // reachable from the local network.
  server.listen(opts.port, '127.0.0.1', () => {
    announce(server, meta, questions.length, opts.open)
  })
}

// Importing this module for `parseArgs` (as the tests do) must not start a server, so the
// CLI only runs when this file is the process entry point.
if (process.argv[1] !== undefined && import.meta.filename === process.argv[1]) {
  main()
}

// The two exports sit at the end to satisfy `useExportsLast`; `parseArgs` is a hoisted
// function declaration, so `resolveOptions` above can still call it.

export interface Options {
  dir: string | null
  port: number
  open: boolean
  retake: boolean
}

// Deliberately a pure parser: it reports what was typed and nothing more. Rejecting an
// unusable value is `resolveOptions`' job, so this stays trivially testable without
// having to intercept a process exit. The manual index (rather than for...of) is what
// lets `--port` consume the argument that follows it.
export function parseArgs(argv: string[]): Options {
  const out: Options = { dir: null, port: 0, open: true, retake: false }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    i += 1
    if (arg === '--port') {
      out.port = Number(argv[i])
      i += 1
    } else if (arg === '--no-open') {
      out.open = false
    } else if (arg === '--retake') {
      out.retake = true
    } else if (out.dir === null && arg !== undefined) {
      out.dir = arg
    }
  }
  return out
}
