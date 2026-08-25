import { once } from 'node:events'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { createServer } from '../lib/server.ts'

const SET_FIXTURE = fileURLToPath(new URL('../examples/set-example', import.meta.url))
const QUIZ_FIXTURE = fileURLToPath(new URL('../examples/all-types', import.meta.url))
const OK = 200
const NOT_FOUND = 404
const SET_QUESTION_IDS = ['q1', 'q2', 'q3', 'q4']

function freshDirFrom(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-set-'))
  cpSync(fixture, dir, { recursive: true })
  return dir
}

async function listen(dir: string): Promise<{ server: Server; base: string }> {
  const server = createServer({ dir })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no port')
  }
  return { server, base: `http://127.0.0.1:${address.port}` }
}

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

test('GET /api/answers on a brand new set shuffles order before any run has happened', async () => {
  const { server: s1, base: b1 } = await listen(freshDirFrom(SET_FIXTURE))
  server = s1
  const res = await fetch(`${b1}/api/answers`)
  expect(res.status).toBe(OK)
  const answers = await res.json()
  expect(answers.order).toBeDefined()
  expect([...answers.order].sort()).toEqual(SET_QUESTION_IDS)
})

test('GET /api/answers on a quiz never has an order field', async () => {
  const { server: s2, base: b2 } = await listen(freshDirFrom(QUIZ_FIXTURE))
  server = s2
  const res = await fetch(`${b2}/api/answers`)
  const answers = await res.json()
  expect(answers.order).toBeUndefined()
})

function putAnswers(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('submitting a set scores it, appends history, and resets to a fresh reshuffled draft', async () => {
  const dir = freshDirFrom(SET_FIXTURE)
  const started = await listen(dir)
  server = started.server

  await putAnswers(started.base, {
    responses: {
      q1: { value: 'b', flagged: false },
      q2: { value: ['a', 'c'], flagged: false },
      q3: { value: { 1: 'complete', 2: 'array' }, flagged: true },
      q4: { value: { l1: 'r1', l2: 'r2', l3: 'r1' }, flagged: false },
    },
  })

  const res = await fetch(`${started.base}/api/submit`, { method: 'POST' })
  expect(res.status).toBe(OK)
  const body = await res.json()
  expect(body).toEqual({
    ok: true,
    result: {
      correct: 3,
      total: 4,
      perQuestion: { q1: true, q2: true, q3: true, q4: false },
    },
  })

  const history = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'))
  expect(history.runs).toHaveLength(1)
  expect(history.runs[0].correct).toBe(3)
  expect(history.runs[0].flagged).toEqual(['q3'])

  const after = await (await fetch(`${started.base}/api/answers`)).json()
  expect(after.status).toBe('draft')
  expect(after.responses.q1).toEqual({ value: null, flagged: false })
  expect(after.order).toBeDefined()
})

test('a set never becomes unretakeable — submitting twice appends two history runs', async () => {
  const dir = freshDirFrom(SET_FIXTURE)
  const started = await listen(dir)
  server = started.server

  expect((await fetch(`${started.base}/api/submit`, { method: 'POST' })).status).toBe(OK)
  expect((await fetch(`${started.base}/api/submit`, { method: 'POST' })).status).toBe(OK)

  const history = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'))
  expect(history.runs).toHaveLength(2)
})

test('submitting a set does not emit "submitted" -- the process must keep running', async () => {
  const started = await listen(freshDirFrom(SET_FIXTURE))
  server = started.server

  let emitted = false
  server.on('submitted', () => {
    emitted = true
  })
  await fetch(`${started.base}/api/submit`, { method: 'POST' })
  expect(emitted).toBe(false)
})

test('POST /api/finish emits the finish payload with every completed run and responds ok', async () => {
  const dir = freshDirFrom(SET_FIXTURE)
  const { server: s, base: b } = await listen(dir)
  server = s

  await fetch(`${b}/api/submit`, { method: 'POST' })
  const emitted = once(server, 'finished')
  const res = await fetch(`${b}/api/finish`, { method: 'POST' })
  expect(res.status).toBe(OK)
  const [payload] = await emitted
  expect(payload.quizId).toBe('b7c2')
  expect(payload.quizDir).toBe(dir)
  expect(payload.kind).toBe('set')
  expect(payload.runs).toHaveLength(1)
})

test('POST /api/finish does not exist for a quiz', async () => {
  const { server: s, base: b } = await listen(freshDirFrom(QUIZ_FIXTURE))
  server = s
  const res = await fetch(`${b}/api/finish`, { method: 'POST' })
  expect(res.status).toBe(NOT_FOUND)
})
