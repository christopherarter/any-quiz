import { cpSync, mkdtempSync } from 'node:fs'
import { request as httpRequest, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createServer } from '../lib/server.ts'

const FIXTURE = fileURLToPath(new URL('../examples/all-types', import.meta.url))

const HTML_CONTENT_TYPE_RE = /text\/html/
const JS_CONTENT_TYPE_RE = /javascript/
const ASSET_SRC_RE = /src="(\/assets\/[^"]+\.js)"/

const OK = 200
const NO_CONTENT = 204
const BAD_REQUEST = 400
const NOT_FOUND = 404
const PAYLOAD_TOO_LARGE = 413
const REJECTED_STATUSES = [BAD_REQUEST, NOT_FOUND]
const FIXTURE_QUESTION_COUNT = 6
const TWO_MEGABYTES = 2_000_000

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

const putAnswers = (body: unknown) =>
  fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

test('GET /api/answers returns a draft skeleton before anything is saved', async () => {
  const a = await (await fetch(`${base}/api/answers`)).json()
  expect(a.status).toBe('draft')
  expect(a.quizId).toBe('a3f9')
  expect(a.responses.q1).toEqual({ value: null, flagged: false })
})

test('PUT /api/answers persists a draft that GET reads back', async () => {
  const put = await putAnswers({ responses: { q1: { value: 'b', flagged: true } } })
  expect(put.status).toBe(NO_CONTENT)
  const a = await (await fetch(`${base}/api/answers`)).json()
  expect(a.responses.q1).toEqual({ value: 'b', flagged: true })
  expect(a.status).toBe('draft')
})

test('PUT with an unknown question id is rejected and changes nothing', async () => {
  const res = await putAnswers({ responses: { nope: { value: 'x', flagged: false } } })
  expect(res.status).toBe(BAD_REQUEST)
  const a = await (await fetch(`${base}/api/answers`)).json()
  expect(a.responses).not.toHaveProperty('nope')
  expect(a.responses.q1.value).toBe('b')
})

// Drives every AnswerValue shape the schema accepts (string, string[], Record<string,
// string>) through a real PUT and back out through a real GET, against the actual running
// server -- not the validators directly -- so this keeps passing regardless of how the
// server implements storage or validation internally.
test('PUT /api/answers round-trips every AnswerValue shape through a real GET', async () => {
  const put = await putAnswers({
    responses: {
      q1: { value: 'b', flagged: false },
      q2: { value: ['a', 'c'], flagged: false },
      q6: { value: { l1: 'r1', l2: 'r2' }, flagged: true },
    },
  })
  expect(put.status).toBe(NO_CONTENT)
  const a = await (await fetch(`${base}/api/answers`)).json()
  expect(a.responses.q1).toEqual({ value: 'b', flagged: false })
  expect(a.responses.q2).toEqual({ value: ['a', 'c'], flagged: false })
  expect(a.responses.q6).toEqual({ value: { l1: 'r1', l2: 'r2' }, flagged: true })
})

test('PUT with a non-boolean flagged is rejected with a field-level error and changes nothing', async () => {
  const before = await (await fetch(`${base}/api/answers`)).json()
  const res = await putAnswers({ responses: { q1: { value: 'b', flagged: 'yes' } } })
  expect(res.status).toBe(BAD_REQUEST)
  const body = await res.json()
  expect(Object.keys(body.errors)).toContain('responses.q1.flagged')
  const after = await (await fetch(`${base}/api/answers`)).json()
  expect(after).toEqual(before)
})

test('PUT with a value of a type the schema does not accept is rejected with a field-level error and changes nothing', async () => {
  const before = await (await fetch(`${base}/api/answers`)).json()
  const res = await putAnswers({ responses: { q1: { value: 42, flagged: false } } })
  expect(res.status).toBe(BAD_REQUEST)
  const body = await res.json()
  expect(Object.keys(body.errors)).toContain('responses.q1.value')
  const after = await (await fetch(`${base}/api/answers`)).json()
  expect(after).toEqual(before)
})

test('PUT whose responses field is not an object is rejected with a field-level error', async () => {
  const res = await putAnswers({ responses: 'nope' })
  expect(res.status).toBe(BAD_REQUEST)
  const body = await res.json()
  expect(Object.keys(body.errors)).toContain('responses')
})

test('PUT with malformed JSON is rejected', async () => {
  const res = await fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: '{ not json',
  })
  expect(res.status).toBe(BAD_REQUEST)
})

function oversizedBody(byteLength: number): string {
  return JSON.stringify({ responses: { q1: { value: 'x'.repeat(byteLength), flagged: false } } })
}

test('PUT over the 1 MB body cap is rejected and leaves the draft unaffected', async () => {
  const before = await (await fetch(`${base}/api/answers`)).json()
  const res = await fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: oversizedBody(TWO_MEGABYTES),
  })
  expect(res.status).toBe(PAYLOAD_TOO_LARGE)
  const after = await (await fetch(`${base}/api/answers`)).json()
  expect(after).toEqual(before)
})
