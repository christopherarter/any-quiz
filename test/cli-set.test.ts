import { expect, test } from 'vitest'
import { freshSetDir, start } from './support/cli-child.ts'

const EXIT_OK = 0
const EXIT_ABANDONED = 3

test('SIGTERM with zero completed runs abandons like a quiz', async () => {
  const s = start([freshSetDir()])
  await s.ready
  s.child.kill('SIGTERM')
  expect(await s.exited).toBe(EXIT_ABANDONED)
  expect(s.stdout()).toBe('')
})

test('a submitted run followed by SIGTERM finishes with exit 0 and the runs payload on stdout', async () => {
  const s = start([freshSetDir()])
  const base = await s.ready
  expect((await fetch(`${base}/api/submit`, { method: 'POST' })).status).toBe(200)
  s.child.kill('SIGTERM')
  expect(await s.exited).toBe(EXIT_OK)
  const payload = JSON.parse(s.stdout())
  expect(payload.kind).toBe('set')
  expect(payload.runs).toHaveLength(1)
})

test('clicking finish exits 0 with the runs payload without waiting for a signal', async () => {
  const s = start([freshSetDir()])
  const base = await s.ready
  await fetch(`${base}/api/submit`, { method: 'POST' })
  await fetch(`${base}/api/finish`, { method: 'POST' })
  expect(await s.exited).toBe(EXIT_OK)
  const payload = JSON.parse(s.stdout())
  expect(payload.runs).toHaveLength(1)
})
