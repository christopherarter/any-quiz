import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { validateQuestions } from '../lib/quiz.ts'

const JSON_OBJECT_RE = /JSON object/
const VERSION_RE = /version/
const AT_LEAST_ONE_RE = /at least one/
const DUPLICATE_ID_RE = /duplicate id/
const UNKNOWN_TYPE_RE = /unknown type/
const MISSING_ANSWER_RE = /missing answer/
const NOT_A_CHOICE_ID_RE = /not a choice id/
const PLACEHOLDERS_RE = /placeholders/
const ACCEPT_LIST_RE = /accept-list/
const RIGHT_ID_RE = /right id/
const LEFT_IDS_RE = /left ids/
const LANGUAGE_RE = /language/
const MISSING_PROMPT_RE = /missing prompt/

// biome-ignore lint/suspicious/noExplicitAny: the point of these tests is to feed invalid shapes in
const fixture = (): any =>
  JSON.parse(readFileSync(new URL('../examples/all-types/questions.json', import.meta.url), 'utf8'))

test('accepts the all-types fixture', () => {
  expect(validateQuestions(fixture())).toEqual([])
})

test('rejects a non-object document', () => {
  expect(validateQuestions(null).join()).toMatch(JSON_OBJECT_RE)
})

test('rejects a wrong version', () => {
  const doc = fixture()
  doc.version = 2
  expect(validateQuestions(doc).join()).toMatch(VERSION_RE)
})

test('rejects an empty question list', () => {
  expect(validateQuestions({ version: 1, questions: [] }).join()).toMatch(AT_LEAST_ONE_RE)
})

test('rejects duplicate question ids', () => {
  const doc = fixture()
  doc.questions[1].id = 'q1'
  expect(validateQuestions(doc).join('\n')).toMatch(DUPLICATE_ID_RE)
})

test('rejects an unknown type', () => {
  const doc = fixture()
  doc.questions[0].type = 'essay'
  expect(validateQuestions(doc).join('\n')).toMatch(UNKNOWN_TYPE_RE)
})

test('rejects a missing answer', () => {
  const doc = fixture()
  doc.questions[0].answer = undefined
  expect(validateQuestions(doc).join('\n')).toMatch(MISSING_ANSWER_RE)
})

test('rejects an mcq answer that is not one of its choices', () => {
  const doc = fixture()
  doc.questions[0].answer = 'z'
  expect(validateQuestions(doc).join('\n')).toMatch(NOT_A_CHOICE_ID_RE)
})

test('rejects a blank whose placeholders do not match its blanks array', () => {
  const doc = fixture()
  doc.questions[2].prompt = 'A heap is a {{1}} tree.'
  expect(validateQuestions(doc).join('\n')).toMatch(PLACEHOLDERS_RE)
})

test('rejects a blank with an empty accept-list', () => {
  const doc = fixture()
  doc.questions[2].answer['1'] = []
  expect(validateQuestions(doc).join('\n')).toMatch(ACCEPT_LIST_RE)
})

test('rejects a match answer pointing at an unknown right id', () => {
  const doc = fixture()
  doc.questions[5].answer.l1 = 'r9'
  expect(validateQuestions(doc).join('\n')).toMatch(RIGHT_ID_RE)
})

test('rejects a match answer missing a left id', () => {
  const doc = fixture()
  // biome-ignore lint/performance/noDelete: undefined assignment would leave the key in Object.keys()
  delete doc.questions[5].answer.l2
  expect(validateQuestions(doc).join('\n')).toMatch(LEFT_IDS_RE)
})

test('rejects code without a language', () => {
  const doc = fixture()
  doc.questions[4].language = undefined
  expect(validateQuestions(doc).join('\n')).toMatch(LANGUAGE_RE)
})

test('reports a missing prompt without throwing, even for blank', () => {
  const doc = fixture()
  doc.questions[2].prompt = undefined
  const errors = validateQuestions(doc)
  expect(errors.join('\n')).toMatch(MISSING_PROMPT_RE)
})
