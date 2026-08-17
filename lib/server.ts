import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer as httpCreateServer, type Server, type ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { DIST_DIR } from './buildinfo.ts'
import { loadPublic } from './quiz.ts'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
}

const OK = 200
const BAD_REQUEST = 400
const NOT_FOUND = 404
const METHOD_NOT_ALLOWED = 405

const LEADING_DOTDOT_RE = /^(\.\.[/\\])+/

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': MIME['.json'] as string,
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
  return httpCreateServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (url.pathname === '/api/quiz' && req.method === 'GET') {
      sendJson(res, OK, loadPublic(dir))
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
  })
}
