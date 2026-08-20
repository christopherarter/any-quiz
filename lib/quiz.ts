import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateQuestions } from './question-schema.ts'
import type {
  Answers,
  Meta,
  PublicQuestion,
  Question,
  QuestionsDoc,
  ResponseEntry,
} from './types.ts'

class QuizError extends Error {
  readonly errors: string[]
  constructor(message: string, errors: string[] = []) {
    super(message)
    this.name = 'QuizError'
    this.errors = errors
  }
}

const STAMP_STRIP_RE = /[-:]/g
const STAMP_FRACTIONAL_SECONDS_RE = /\.\d+Z$/

function skeleton(quizId: string, questionIds: string[]): Answers {
  const now = new Date().toISOString()
  const responses: Record<string, ResponseEntry> = {}
  for (const id of questionIds) {
    responses[id] = { value: null, flagged: false }
  }
  return { quizId, status: 'draft', startedAt: now, updatedAt: now, submittedAt: null, responses }
}

function readJson(path: string, label: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    const error = new QuizError(`cannot read ${label} at ${path}`, [(err as Error).message])
    error.cause = err
    throw error
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    const error = new QuizError(`${label} is not valid JSON`, [(err as Error).message])
    error.cause = err
    throw error
  }
}

export function loadFull(dir: string): { meta: Meta; questions: Question[] } {
  const meta = readJson(join(dir, 'meta.json'), 'meta.json') as Meta
  const doc = readJson(join(dir, 'questions.json'), 'questions.json')
  const errors = validateQuestions(doc)
  if (errors.length > 0) {
    throw new QuizError('questions.json failed validation', errors)
  }
  return { meta, questions: (doc as QuestionsDoc).questions }
}

export function loadPublic(dir: string): { meta: Meta; questions: PublicQuestion[] } {
  const { meta, questions } = loadFull(dir)
  const questionsList: PublicQuestion[] = questions.map((q) => {
    const { answer: _answer, rationale: _rationale, ...rest } = q
    return rest as PublicQuestion
  })
  return { meta, questions: questionsList }
}

export function answersPath(dir: string): string {
  return join(dir, 'answers.json')
}

export function readAnswers(dir: string, quizId: string, questionIds: string[]): Answers {
  const path = answersPath(dir)
  if (!existsSync(path)) {
    return skeleton(quizId, questionIds)
  }
  const saved = readJson(path, 'answers.json') as Answers
  saved.responses ??= {}
  for (const id of questionIds) {
    saved.responses[id] ??= { value: null, flagged: false }
  }
  return saved
}

export function writeAnswers(dir: string, answers: Answers): void {
  answers.updatedAt = new Date().toISOString()
  const path = answersPath(dir)
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(answers, null, 2)}\n`)
  renameSync(tmpPath, path)
}

export function archiveAnswers(dir: string): string {
  const path = answersPath(dir)
  const saved = readJson(path, 'answers.json') as Answers
  const stamp = (saved.submittedAt ?? new Date().toISOString())
    .replace(STAMP_STRIP_RE, '')
    .replace(STAMP_FRACTIONAL_SECONDS_RE, 'Z')
  const target = join(dir, `answers-${stamp}.json`)
  renameSync(path, target)
  return target
}

// biome-ignore lint/performance/noBarrelFile: validateQuestions/TYPES live in question-schema.ts to keep quiz.ts under the line-count cap; every existing caller already imports them from lib/quiz.ts
export { TYPES, validateQuestions } from './question-schema.ts'
export { QuizError }
