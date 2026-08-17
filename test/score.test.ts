import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { loadFull } from '../lib/quiz.ts'
import { CLOSED_TYPES, normalizeText, scoreQuestion, scoreQuiz } from '../lib/score.ts'
import type { Question, ResponseEntry } from '../lib/types.ts'

const fixtureDir = fileURLToPath(new URL('../examples/all-types', import.meta.url))
const { questions } = loadFull(fixtureDir)
const byId = new Map(questions.map((item) => [item.id, item]))
const q = (id: string): Question => {
  const found = byId.get(id)
  if (!found) {
    throw new Error(`fixture drifted: ${id}`)
  }
  return found
}

test('normalizeText trims, lowercases, and collapses whitespace', () => {
  expect(normalizeText('  Complete   Binary ')).toBe('complete binary')
})

test('CLOSED_TYPES holds exactly the four scorable types', () => {
  expect([...CLOSED_TYPES].sort()).toEqual(['blank', 'match', 'mcq', 'multi'])
})

test('mcq scores by exact choice id', () => {
  expect(scoreQuestion(q('q1'), 'b')).toBe(true)
  expect(scoreQuestion(q('q1'), 'a')).toBe(false)
})

test('multi is set equality, not order-sensitive', () => {
  expect(scoreQuestion(q('q2'), ['c', 'a'])).toBe(true)
  expect(scoreQuestion(q('q2'), ['a'])).toBe(false)
  expect(scoreQuestion(q('q2'), ['a', 'c', 'b'])).toBe(false)
})

test('multi set comparison is immune to a join-separator collision in choice ids', () => {
  // Under a sort-then-join comparison, ['a', 'b|c d'] and ['a|b', 'c d'] can collide to the
  // same joined string ("a|b|c d") even though the sets {a, "b|c d"} and {"a|b", "c d"} are
  // different. A real set comparison must still score this wrong.
  const question: Question = {
    id: 'sep',
    type: 'multi',
    prompt: 'Which contain a vowel?',
    rationale: 'n/a',
    choices: [
      { id: 'a', text: 'a' },
      { id: 'b|c d', text: 'b|c d' },
      { id: 'a|b', text: 'a|b' },
      { id: 'c d', text: 'c d' },
    ],
    answer: ['a|b', 'c d'],
  }
  expect(scoreQuestion(question, ['a', 'b|c d'])).toBe(false)
})

test('blank matches its accept-list case- and whitespace-insensitively', () => {
  expect(scoreQuestion(q('q3'), { 1: '  Complete ', 2: 'ARRAY' })).toBe(true)
  expect(scoreQuestion(q('q3'), { 1: 'complete binary', 2: 'array' })).toBe(true)
  expect(scoreQuestion(q('q3'), { 1: 'complete', 2: 'linked list' })).toBe(false)
})

test('match requires every pair to be right', () => {
  expect(scoreQuestion(q('q6'), { l1: 'r1', l2: 'r2', l3: 'r3' })).toBe(true)
  expect(scoreQuestion(q('q6'), { l1: 'r1', l2: 'r3', l3: 'r2' })).toBe(false)
  expect(scoreQuestion(q('q6'), { l1: 'r1', l2: 'r2' })).toBe(false)
})

test('open types never score as correct', () => {
  expect(scoreQuestion(q('q4'), 'a great answer')).toBe(false)
  expect(scoreQuestion(q('q5'), 'const parent = (i: number) => Math.floor((i - 1) / 2)')).toBe(
    false,
  )
})

test('a null value is never correct', () => {
  for (const question of questions) {
    expect(scoreQuestion(question, null), `${question.id} scored null as correct`).toBe(false)
  }
})

test('scoreQuiz counts only closed types and lists the rest for grading', () => {
  const responses: Record<string, ResponseEntry> = {
    q1: { value: 'b', flagged: false },
    q2: { value: ['a', 'c'], flagged: false },
    q3: { value: { 1: 'complete', 2: 'array' }, flagged: true },
    q4: { value: 'because heapify ignores input order', flagged: false },
    q5: { value: 'i => (i-1)/2', flagged: false },
    q6: { value: { l1: 'r1', l2: 'r3', l3: 'r2' }, flagged: false },
  }
  const result = scoreQuiz(questions, responses)
  // biome-ignore lint/style/noMagicNumbers: the all-types fixture has exactly 4 closed-type questions; a named constant would be less clear than the literal here
  expect(result.auto.total).toBe(4)
  // biome-ignore lint/style/noMagicNumbers: 3 of the 4 closed-type responses above are correct; a named constant would be less clear than the literal here
  expect(result.auto.correct).toBe(3)
  expect(result.auto.perQuestion).toEqual({ q1: true, q2: true, q3: true, q6: false })
  expect(result.needsGrading).toEqual(['q4', 'q5'])
  expect(result.flagged).toEqual(['q3'])
})
