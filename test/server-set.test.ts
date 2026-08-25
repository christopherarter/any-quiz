import { cpSync, mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { createServer } from '../lib/server.ts'

const SET_FIXTURE = fileURLToPath(new URL('../examples/set-example', import.meta.url))
const QUIZ_FIXTURE = fileURLToPath(new URL('../examples/all-types', import.meta.url))
const OK = 200
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
