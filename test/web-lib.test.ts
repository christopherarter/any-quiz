import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { parseBlanks } from '../app/lib/blanks.ts'
import { isAnswered, summarize } from '../app/lib/progress.ts'
import { loadPublic } from '../lib/quiz.ts'
import type { PublicQuestion, ResponseEntry } from '../lib/types.ts'

const { questions } = loadPublic(fileURLToPath(new URL('../examples/all-types', import.meta.url)))
const byId = Object.fromEntries(questions.map((q) => [q.id, q])) as Record<string, PublicQuestion>

const FIXTURE_QUESTION_COUNT = 6

// Reads through the real fixture rather than hand-built objects, so a fixture that drifts
// away from these ids fails loudly here instead of quietly asserting nothing.
function q(id: string): PublicQuestion {
  const found = byId[id]
  if (!found) {
    throw new Error(`fixture drifted: ${id}`)
  }
  return found
}

test('parseBlanks interleaves text and blank segments', () => {
  expect(parseBlanks('A binary heap is a {{1}} tree stored in an {{2}}.')).toEqual([
    { kind: 'text', value: 'A binary heap is a ' },
    { kind: 'blank', id: '1' },
    { kind: 'text', value: ' tree stored in an ' },
    { kind: 'blank', id: '2' },
    { kind: 'text', value: '.' },
  ])
})

test('parseBlanks handles a prompt with no placeholders', () => {
  expect(parseBlanks('no blanks here')).toEqual([{ kind: 'text', value: 'no blanks here' }])
})

// A zero-length text segment would render as an empty node between two inputs, so the
// boundary cases have to drop them rather than emit `{kind: 'text', value: ''}`.
test('parseBlanks emits no empty text segments at the edges or between adjacent blanks', () => {
  expect(parseBlanks('{{1}} then {{2}}')).toEqual([
    { kind: 'blank', id: '1' },
    { kind: 'text', value: ' then ' },
    { kind: 'blank', id: '2' },
  ])
  expect(parseBlanks('{{a}}{{b}}')).toEqual([
    { kind: 'blank', id: 'a' },
    { kind: 'blank', id: 'b' },
  ])
  expect(parseBlanks('')).toEqual([])
})

// The segments are what the browser renders in place of the prompt, so losing or
// reordering any character is a visible defect. Rebuilding the original string from them
// checks the whole partition at once, which the per-case assertions above do not.
test('parseBlanks segments reassemble into the original prompt', () => {
  const prompts = ['A {{1}} tree in an {{2}}.', '{{a}}{{b}}', 'no blanks', '{{x}}', '']
  for (const prompt of prompts) {
    const rebuilt = parseBlanks(prompt)
      .map((s) => (s.kind === 'text' ? s.value : `{{${s.id}}}`))
      .join('')
    expect(rebuilt, `lost text for ${JSON.stringify(prompt)}`).toBe(prompt)
  }
})

test('isAnswered treats null, blank strings, and empty arrays as unanswered', () => {
  expect(isAnswered(q('q1'), null)).toBe(false)
  expect(isAnswered(q('q1'), 'b')).toBe(true)
  expect(isAnswered(q('q2'), [])).toBe(false)
  expect(isAnswered(q('q2'), ['a'])).toBe(true)
  expect(isAnswered(q('q4'), '   ')).toBe(false)
  expect(isAnswered(q('q4'), 'an answer')).toBe(true)
  expect(isAnswered(q('q5'), '')).toBe(false)
  expect(isAnswered(q('q5'), 'heapify()')).toBe(true)
})

test('isAnswered requires every blank and every match pair to be filled', () => {
  expect(isAnswered(q('q3'), { 1: 'complete', 2: '' })).toBe(false)
  expect(isAnswered(q('q3'), { 1: 'complete', 2: 'array' })).toBe(true)
  expect(isAnswered(q('q6'), { l1: 'r1', l2: 'r2' })).toBe(false)
  expect(isAnswered(q('q6'), { l1: 'r1', l2: 'r2', l3: 'r3' })).toBe(true)
})

// A missing key and a present-but-empty key are different inputs that must reach the same
// answer; only the second is covered above.
test('isAnswered treats an absent blank key the same as an empty one', () => {
  expect(isAnswered(q('q3'), { 1: 'complete' })).toBe(false)
  expect(isAnswered(q('q3'), {})).toBe(false)
  expect(isAnswered(q('q6'), {})).toBe(false)
})

// Drafts are round-tripped through JSON on disk, so a value can arrive shaped for the
// wrong question type. Reporting "answered" for one would let a quiz be submitted with a
// question the user never actually filled in.
test('isAnswered rejects a value shaped for a different question type', () => {
  expect(isAnswered(q('q3'), ['complete', 'array'])).toBe(false)
  expect(isAnswered(q('q3'), 'complete')).toBe(false)
  expect(isAnswered(q('q6'), [])).toBe(false)
  expect(isAnswered(q('q1'), { 1: 'b' })).toBe(false)
  expect(isAnswered(q('q2'), 'a')).toBe(false)
})

test('summarize counts answered and flagged questions', () => {
  const responses: Record<string, ResponseEntry> = {
    q1: { value: 'b', flagged: false },
    q2: { value: [], flagged: true },
    q4: { value: 'text', flagged: true },
  }
  expect(summarize(questions, responses)).toEqual({
    answered: 2,
    total: FIXTURE_QUESTION_COUNT,
    flagged: 2,
  })
})

// The progress indicator renders before the first draft loads, so an empty map is the
// state the user sees first -- it has to report 0 answered rather than throw on the
// missing entries.
test('summarize reports zero progress for an empty response map', () => {
  expect(summarize(questions, {})).toEqual({
    answered: 0,
    total: FIXTURE_QUESTION_COUNT,
    flagged: 0,
  })
})

// `flagged` is independent of `answered`: a user can flag a question for review without
// answering it, and both counts drive separate parts of the UI.
test('summarize counts a flagged but unanswered question in flagged only', () => {
  expect(summarize(questions, { q5: { value: null, flagged: true } })).toEqual({
    answered: 0,
    total: FIXTURE_QUESTION_COUNT,
    flagged: 1,
  })
})
