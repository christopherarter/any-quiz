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

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': JSON_MIME,
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
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

// Rejects once the body exceeds MAX_BODY without calling `req.destroy()`: destroying the
// request would tear down the whole duplex socket before a response can be written,
// resetting the client's connection instead of handing it a 400. Later chunks on an
// already-rejected request are dropped rather than buffered, so memory stays bounded.
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let rejected = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      if (rejected) {
        return
      }
      size += chunk.length
      if (size > MAX_BODY) {
        rejected = true
        reject(new Error('body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!rejected) {
        resolve(Buffer.concat(chunks).toString('utf8'))
      }
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
    // The request's remaining bytes are never fully drained, so this connection
    // cannot be safely reused for a pipelined next request -- tell the client (and
    // Node) to close it rather than keep it alive.
    sendJson(res, BAD_REQUEST, { error: 'body too large' }, { connection: 'close' })
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
