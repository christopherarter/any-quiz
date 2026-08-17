import { cpSync, mkdtempSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { DIST_DIR } from '../lib/buildinfo.ts'
import { createServer, resolveDistPath } from '../lib/server.ts'

const FIXTURE = fileURLToPath(new URL('../examples/all-types', import.meta.url))

const HTML_CONTENT_TYPE_RE = /text\/html/
const JS_CONTENT_TYPE_RE = /javascript/
const ASSET_SRC_RE = /src="(\/assets\/[^"]+\.js)"/

const OK = 200
const BAD_REQUEST = 400
const NOT_FOUND = 404
const REJECTED_STATUSES = [BAD_REQUEST, NOT_FOUND]
const FIXTURE_QUESTION_COUNT = 6

function freshQuizDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-'))
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}

let server: Server
let base: string
let port: number

beforeAll(async () => {
  server = createServer({ dir: freshQuizDir() })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no port')
  }
  ;({ port } = address)
  base = `http://127.0.0.1:${port}`
})

afterAll(() => server.close())

test('GET / serves the built page shell', async () => {
  const res = await fetch(base)
  expect(res.status).toBe(OK)
  expect(res.headers.get('content-type')).toMatch(HTML_CONTENT_TYPE_RE)
})

test('GET /api/quiz never includes the answer key', async () => {
  const res = await fetch(`${base}/api/quiz`)
  const body = await res.text()
  expect(res.status).toBe(OK)
  expect(body, 'answer leaked to the browser').not.toContain('"answer"')
  expect(body, 'rationale leaked to the browser').not.toContain('"rationale"')
  const parsed = JSON.parse(body)
  expect(parsed.meta.id).toBe('a3f9')
  expect(parsed.questions).toHaveLength(FIXTURE_QUESTION_COUNT)
})

test('built assets are served', async () => {
  const html = await (await fetch(base)).text()
  const asset = ASSET_SRC_RE.exec(html)?.[1]
  expect(asset, 'no bundled script found in index.html').toBeTruthy()
  const res = await fetch(`${base}${asset}`)
  expect(res.status).toBe(OK)
  expect(res.headers.get('content-type')).toMatch(JS_CONTENT_TYPE_RE)
})

test('path traversal is rejected', async () => {
  const res = await fetch(`${base}/assets/../../lib/quiz.ts`, { redirect: 'manual' })
  expect(REJECTED_STATUSES).toContain(res.status)
})

test('unknown api routes 404', async () => {
  expect((await fetch(`${base}/api/nope`)).status).toBe(NOT_FOUND)
})

// The test above sends the traversal through `fetch`, whose WHATWG URL parser resolves
// ".." (and, case-insensitively, "%2e%2e") client-side before the request ever leaves
// the browser -- the server never sees raw traversal bytes, so that test alone does not
// exercise the server's own defenses. `http.request` performs no such client-side
// normalization: confirmed with a bare server that echoed back the literal,
// unnormalized `req.url` it received for this exact path. This test sends the hostile
// bytes for real and checks what the server does once they arrive.
test('raw unnormalized traversal bytes reach the server and still cannot read files outside dist', async () => {
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: '/assets/../../lib/quiz.ts', method: 'GET' },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
  expect(REJECTED_STATUSES).toContain(response.status)
  expect(response.body, 'source of lib/quiz.ts leaked to the browser').not.toContain('QuizError')
})

// Direct unit-level exercise of the guard itself, bypassing `new URL()` (and therefore
// its own ".."/"%2e%2e" resolution) entirely. Every request that reaches `serveStatic` in
// practice has already been normalized by `new URL(req.url, ...)`, so `resolveDistPath`'s
// own containment check is otherwise never exercised against genuinely raw input. Calling
// it directly with strings that were never routed through URL parsing is the only way to
// prove the guard holds on its own, independent of that upstream behavior.
test('resolveDistPath contains every input under DIST_DIR, even raw traversal', () => {
  const realQuizTsPath = fileURLToPath(new URL('../lib/quiz.ts', import.meta.url))
  const adversarial = [
    '/../../lib/quiz.ts',
    '../../../lib/quiz.ts',
    '/assets/../../../../../../etc/passwd',
    '..%2f..%2flib/quiz.ts',
  ]
  for (const input of adversarial) {
    const resolved = resolveDistPath(input)
    expect(
      resolved === null || resolved.startsWith(DIST_DIR),
      `escaped DIST_DIR for ${input}`,
    ).toBe(true)
    expect(resolved, `resolved to the real source file for ${input}`).not.toBe(realQuizTsPath)
  }
})
