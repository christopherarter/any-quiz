import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import {
  answersPath,
  archiveAnswers,
  loadFull,
  loadPublic,
  QuizError,
  readAnswers,
  scaffoldQuiz,
  validateQuestions,
  writeAnswers,
} from '../lib/quiz.ts'

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
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/
const ID_RE = /^[0-9a-f]{4}$/
const KEBAB_RE = /kebab-case/
const DIR_NAME_RE = /^\d{4}-\d{2}-\d{2}-rust-lifetimes-[0-9a-f]{4}$/

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

const FIXTURE_DIR = fileURLToPath(new URL('../examples/all-types', import.meta.url))

test('loadFull keeps the answer key', () => {
  const { meta, questions } = loadFull(FIXTURE_DIR)
  expect(meta.id).toBe('a3f9')
  const [first] = questions
  if (first?.type !== 'mcq') {
    throw new Error('fixture drifted')
  }
  expect(first.answer).toBe('b')
  expect(first.rationale).toBeTruthy()
})

test('loadPublic strips answer and rationale from every question', () => {
  for (const q of loadPublic(FIXTURE_DIR).questions) {
    expect(q, `${q.id} still has answer`).not.toHaveProperty('answer')
    expect(q, `${q.id} still has rationale`).not.toHaveProperty('rationale')
  }
})

test('serialized loadPublic output contains no answer key anywhere', () => {
  const json = JSON.stringify(loadPublic(FIXTURE_DIR))
  expect(json).not.toContain('"answer"')
  expect(json).not.toContain('"rationale"')
})

test('loadPublic keeps the fields the browser needs', () => {
  const { questions } = loadPublic(FIXTURE_DIR)
  const mcq = questions.find((q) => q.type === 'mcq')
  const code = questions.find((q) => q.type === 'code')
  const match = questions.find((q) => q.type === 'match')
  // biome-ignore lint/style/noMagicNumbers: fixture's mcq question has exactly 3 choices; a named constant would be less clear than the literal here
  expect(mcq?.type === 'mcq' && mcq.choices).toHaveLength(3)
  expect(code?.type === 'code' && code.language).toBe('typescript')
  // biome-ignore lint/style/noMagicNumbers: fixture's match question has exactly 3 right-side entries; a named constant would be less clear than the literal here
  expect(match?.type === 'match' && match.right).toHaveLength(3)
})

test('loadFull throws QuizError for a missing directory', () => {
  expect(() => loadFull('/nonexistent/quiz/dir')).toThrow(QuizError)
})

const tmp = () => mkdtempSync(join(tmpdir(), 'anyquiz-'))

test('readAnswers returns a skeleton when no file exists', () => {
  const a = readAnswers(tmp(), 'a3f9', ['q1', 'q2'])
  expect(a.quizId).toBe('a3f9')
  expect(a.status).toBe('draft')
  expect(a.submittedAt).toBeNull()
  expect(a.responses).toEqual({
    q1: { value: null, flagged: false },
    q2: { value: null, flagged: false },
  })
})

test('writeAnswers then readAnswers round-trips', () => {
  const dir = tmp()
  const a = readAnswers(dir, 'a3f9', ['q1'])
  a.responses.q1 = { value: 'b', flagged: true }
  writeAnswers(dir, a)
  // biome-ignore lint/suspicious/noUnnecessaryConditions: tsc requires the `?.` under noUncheckedIndexedAccess even though biome's inferencer doesn't model it
  expect(readAnswers(dir, 'a3f9', ['q1']).responses.q1?.value).toBe('b')
})

test('writeAnswers stamps updatedAt and leaves no tmp file behind', () => {
  const dir = tmp()
  writeAnswers(dir, readAnswers(dir, 'a3f9', ['q1']))
  expect(readAnswers(dir, 'a3f9', ['q1']).updatedAt).toMatch(ISO_TIMESTAMP_RE)
  expect(readdirSync(dir)).toEqual(['answers.json'])
})

test('readAnswers backfills question ids added since the draft was saved', () => {
  const dir = tmp()
  writeAnswers(dir, readAnswers(dir, 'a3f9', ['q1']))
  expect(readAnswers(dir, 'a3f9', ['q1', 'q2']).responses.q2).toEqual({
    value: null,
    flagged: false,
  })
})

test('archiveAnswers renames the file to a filename-safe timestamp', () => {
  const dir = tmp()
  const a = readAnswers(dir, 'a3f9', ['q1'])
  a.status = 'submitted'
  a.submittedAt = '2026-08-17T14:11:48.000Z'
  writeAnswers(dir, a)
  const archived = archiveAnswers(dir)
  expect(archived).toBe(join(dir, 'answers-20260817T141148Z.json'))
  expect(existsSync(archived)).toBe(true)
  expect(existsSync(answersPath(dir))).toBe(false)
})

test('readAnswers throws QuizError on a corrupt answers file', () => {
  const dir = tmp()
  writeFileSync(answersPath(dir), '{ not json')
  expect(() => readAnswers(dir, 'a3f9', ['q1'])).toThrow(QuizError)
})

test('scaffoldQuiz writes meta.json with a generated id and timestamp', () => {
  const baseDir = tmp()
  const { dir, meta } = scaffoldQuiz(baseDir, {
    slug: 'rust-lifetimes',
    title: 'Rust Lifetimes & Borrowing',
    topic: 'One sentence on what this quiz covers',
  })

  expect(basename(dir)).toMatch(DIR_NAME_RE)
  expect(meta).toEqual({
    id: expect.stringMatching(ID_RE),
    slug: 'rust-lifetimes',
    title: 'Rust Lifetimes & Borrowing',
    topic: 'One sentence on what this quiz covers',
    createdAt: expect.stringMatching(ISO_TIMESTAMP_RE),
    parentQuizId: null,
    targets: [],
  })
  expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).toEqual(meta)
})

test('scaffoldQuiz accepts an optional parentQuizId and targets', () => {
  const { meta } = scaffoldQuiz(tmp(), {
    slug: 'rust-lifetimes',
    title: 'Follow-up',
    topic: 'Targeting the misses',
    parentQuizId: 'a3f9',
    targets: ['q2', 'q4'],
  })

  expect(meta.parentQuizId).toBe('a3f9')
  expect(meta.targets).toEqual(['q2', 'q4'])
})

test('scaffoldQuiz rejects a slug that is not kebab-case', () => {
  const attempt = () => scaffoldQuiz(tmp(), { slug: 'Not Kebab!', title: 'T', topic: 'Top' })
  expect(attempt).toThrow(QuizError)
  try {
    attempt()
  } catch (err) {
    expect((err as InstanceType<typeof QuizError>).errors.join('\n')).toMatch(KEBAB_RE)
  }
})

test('scaffoldQuiz creates baseDir when it does not exist yet', () => {
  const baseDir = join(tmp(), 'nested', 'any-quiz')
  const { dir } = scaffoldQuiz(baseDir, { slug: 'rust-lifetimes', title: 'T', topic: 'Top' })
  expect(existsSync(join(dir, 'meta.json'))).toBe(true)
})

test('scaffoldQuiz wraps a filesystem failure as QuizError', () => {
  const filePath = join(tmp(), 'plain-file')
  writeFileSync(filePath, 'x')
  const attempt = () => scaffoldQuiz(filePath, { slug: 'rust-lifetimes', title: 'T', topic: 'Top' })
  expect(attempt).toThrow(QuizError)
})
