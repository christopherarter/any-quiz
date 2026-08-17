import { once } from 'node:events'
import { cpSync, mkdtempSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { createServer } from '../lib/server.ts'
import type { Answers, ResultPayload } from '../lib/types.ts'

const FIXTURE = fileURLToPath(new URL('../examples/all-types', import.meta.url))

const OK = 200
const CONFLICT = 409
const CLOSED_TYPE_COUNT = 4
const EXPECTED_CORRECT = 2
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/

// Submit drives the quiz into a terminal state, so every test here gets its own server
// and its own copy of the fixture rather than sharing one.
async function startOwnServer(): Promise<{ srv: Server; url: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-submit-'))
  cpSync(FIXTURE, dir, { recursive: true })
  const srv = createServer({ dir })
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const address = srv.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no port')
  }
  return { srv, url: `http://127.0.0.1:${address.port}`, dir }
}

test('POST /api/submit marks submitted and emits the scored result payload', async () => {
  const { srv, url, dir } = await startOwnServer()

  await fetch(`${url}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      responses: {
        q1: { value: 'b', flagged: false },
        q3: { value: { 1: 'complete', 2: 'array' }, flagged: true },
        q4: { value: 'heapify ignores input order', flagged: false },
      },
    }),
  })

  const emitted = once(srv, 'submitted') as Promise<[ResultPayload]>
  const res = await fetch(`${url}/api/submit`, { method: 'POST' })
  expect(res.status).toBe(OK)
  const [payload] = await emitted

  expect(payload.quizId).toBe('a3f9')
  expect(payload.quizDir).toBe(dir)
  expect(payload.auto.total).toBe(CLOSED_TYPE_COUNT)
  expect(payload.auto.correct).toBe(EXPECTED_CORRECT)
  expect(payload.needsGrading).toEqual(['q4', 'q5'])
  expect(payload.flagged).toEqual(['q3'])
  // biome-ignore lint/suspicious/noUnnecessaryConditions: biome does not model noUncheckedIndexedAccess; tsc requires this guard
  expect(payload.responses.q1?.value).toBe('b')

  const saved = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as Answers
  expect(saved.status).toBe('submitted')
  expect(saved.submittedAt).toMatch(ISO_TIMESTAMP_RE)

  srv.close()
})

test('answers.json is already persisted as submitted by the time the event fires', async () => {
  const { srv, url, dir } = await startOwnServer()

  // Read the file from inside the listener: if persistence happened after the emit, a
  // crash between the two would lose the submission the payload claims to represent.
  const seen = once(srv, 'submitted').then(() => {
    const onEmit = JSON.parse(readFileSync(join(dir, 'answers.json'), 'utf8')) as Answers
    return onEmit.status
  })

  await fetch(`${url}/api/submit`, { method: 'POST' })
  expect(await seen).toBe('submitted')

  srv.close()
})

test('a second submit is rejected and does not re-emit', async () => {
  const { srv, url } = await startOwnServer()

  expect((await fetch(`${url}/api/submit`, { method: 'POST' })).status).toBe(OK)

  let reEmitted = false
  srv.on('submitted', () => {
    reEmitted = true
  })
  const second = await fetch(`${url}/api/submit`, { method: 'POST' })
  expect(second.status).toBe(CONFLICT)
  expect(reEmitted).toBe(false)

  srv.close()
})

test('a rejected second submit leaves the stored answers untouched', async () => {
  const { srv, url, dir } = await startOwnServer()

  await fetch(`${url}/api/submit`, { method: 'POST' })
  const after = readFileSync(join(dir, 'answers.json'))

  await fetch(`${url}/api/submit`, { method: 'POST' })
  expect(readFileSync(join(dir, 'answers.json')).equals(after)).toBe(true)

  srv.close()
})
