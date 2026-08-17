import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../examples/all-types/${name}`, import.meta.url), 'utf8'))

test('fixture covers all six question types exactly once, in order', () => {
  const doc = read('questions.json')
  expect(doc.questions.map((q: { type: string }) => q.type)).toEqual([
    'mcq',
    'multi',
    'blank',
    'short',
    'code',
    'match',
  ])
})

test('every fixture question carries an answer and a rationale', () => {
  for (const q of read('questions.json').questions) {
    expect(q.answer, `${q.id} missing answer`).toBeDefined()
    expect(q.rationale, `${q.id} missing rationale`).toBeTruthy()
  }
})

test('fixture meta matches the documented shape', () => {
  const meta = read('meta.json')
  expect(meta.id).toBe('a3f9')
  expect(meta.parentQuizId).toBeNull()
  expect(meta.targets).toEqual([])
})
