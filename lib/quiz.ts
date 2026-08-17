import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Meta, PublicQuestion, Question, QuestionsDoc, QuestionType } from './types.ts'

const TYPES: QuestionType[] = ['mcq', 'multi', 'blank', 'short', 'code', 'match']

class QuizError extends Error {
  readonly errors: string[]
  constructor(message: string, errors: string[] = []) {
    super(message)
    this.name = 'QuizError'
    this.errors = errors
  }
}

// Validation runs over untrusted JSON, so everything here is `unknown`-shaped on
// purpose. `Loose` is the shape we probe before we are entitled to a Question.
type Loose = Record<string, unknown>

const isString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0

const asArray = (v: unknown): unknown[] => {
  if (Array.isArray(v)) {
    return v
  }
  return []
}

const idsOf = (v: unknown): string[] =>
  asArray(v)
    .map((x) => (x as Loose | null)?.id)
    .filter(isString)

const placeholders = (prompt: string): string[] =>
  [...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string)

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

function hasIdAndText(c: unknown): boolean {
  const loose = c as Loose | null
  return isString(loose?.id) && isString(loose?.text)
}

function checkList(q: Loose, out: string[], field: string): boolean {
  const list = q[field]
  if (!Array.isArray(list) || list.length < 2) {
    out.push(`${String(q.id)}: ${field} must be an array of at least 2 entries`)
    return false
  }
  const ok = list.every(hasIdAndText)
  if (!ok) {
    out.push(`${String(q.id)}: every ${field} entry needs a non-empty id and text`)
  }
  return ok
}

const perType: Record<QuestionType, (q: Loose, out: string[]) => void> = {
  mcq(q, out) {
    if (!checkList(q, out, 'choices')) {
      return
    }
    if (!idsOf(q.choices).includes(q.answer as string)) {
      out.push(`${String(q.id)}: answer "${String(q.answer)}" is not a choice id`)
    }
  },
  multi(q, out) {
    if (!checkList(q, out, 'choices')) {
      return
    }
    if (!Array.isArray(q.answer) || q.answer.length === 0) {
      out.push(`${String(q.id)}: answer must be a non-empty array of choice ids`)
      return
    }
    for (const a of q.answer) {
      if (!idsOf(q.choices).includes(a as string)) {
        out.push(`${String(q.id)}: answer "${String(a)}" is not a choice id`)
      }
    }
  },
  blank(q, out) {
    const declared = idsOf(q.blanks)
    if (declared.length === 0) {
      out.push(`${String(q.id)}: blanks must be a non-empty array of {id, hint}`)
      return
    }
    if (!sameSet(placeholders(q.prompt as string), declared)) {
      out.push(`${String(q.id)}: prompt placeholders {{n}} do not match the blanks array`)
      return
    }
    const answer = q.answer as Record<string, unknown> | null
    if (!answer || typeof answer !== 'object' || !sameSet(Object.keys(answer), declared)) {
      out.push(`${String(q.id)}: answer keys must match the blanks array`)
      return
    }
    for (const [id, accept] of Object.entries(answer)) {
      if (!Array.isArray(accept) || accept.length === 0 || !accept.every(isString)) {
        out.push(`${String(q.id)}: blank "${id}" needs a non-empty accept-list of strings`)
      }
    }
  },
  short(q, out) {
    if (!isString(q.answer)) {
      out.push(`${String(q.id)}: answer must be a non-empty reference answer`)
    }
  },
  code(q, out) {
    if (!isString(q.language)) {
      out.push(`${String(q.id)}: code questions need a language`)
    }
    if (!isString(q.answer)) {
      out.push(`${String(q.id)}: answer must be a non-empty reference solution`)
    }
  },
  match(q, out) {
    if (!checkList(q, out, 'left')) {
      return
    }
    if (!checkList(q, out, 'right')) {
      return
    }
    const answer = q.answer as Record<string, unknown> | null
    if (!answer || typeof answer !== 'object' || !sameSet(Object.keys(answer), idsOf(q.left))) {
      out.push(`${String(q.id)}: answer keys must match the left ids`)
      return
    }
    for (const [l, r] of Object.entries(answer)) {
      if (!idsOf(q.right).includes(r as string)) {
        out.push(`${String(q.id)}: "${l}" maps to "${String(r)}", which is not a right id`)
      }
    }
  },
}

// Validates a single question and appends any problems to `out`. A non-string `type`,
// non-string `prompt`, or missing `answer` all stop before the per-type check runs --
// that check (e.g. blank's `.matchAll()` on `prompt`) assumes those basics already
// hold, and would throw on malformed input instead of reporting it.
function validateQuestion(raw: unknown, index: number, seen: Set<string>, out: string[]): void {
  const q = (raw ?? {}) as Loose
  if (!isString(q.id)) {
    out.push(`question #${index + 1}: missing id`)
    return
  }
  if (seen.has(q.id)) {
    out.push(`${q.id}: duplicate id`)
  }
  seen.add(q.id)
  if (!isString(q.prompt)) {
    out.push(`${q.id}: missing prompt`)
    return
  }
  if (!TYPES.includes(q.type as QuestionType)) {
    out.push(`${q.id}: unknown type "${String(q.type)}"`)
    return
  }
  if (q.answer === undefined) {
    out.push(`${q.id}: missing answer`)
    return
  }
  perType[q.type as QuestionType](q, out)
}

function validateQuestions(doc: unknown): string[] {
  const out: string[] = []
  if (!doc || typeof doc !== 'object') {
    return ['questions.json must be a JSON object']
  }
  const { version, questions } = doc as Loose
  if (version !== 1) {
    out.push(`unsupported version ${JSON.stringify(version)}, expected 1`)
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    out.push('questions must be an array with at least one entry')
    return out
  }

  const seen = new Set<string>()
  for (const [i, raw] of questions.entries()) {
    validateQuestion(raw, i, seen, out)
  }
  return out
}

function readJson(path: string, label: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    throw new QuizError(`cannot read ${label} at ${path}`, [(err as Error).message])
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new QuizError(`${label} is not valid JSON`, [(err as Error).message])
  }
}

export function loadFull(dir: string): { meta: Meta; questions: Question[] } {
  const meta = readJson(join(dir, 'meta.json'), 'meta.json') as Meta
  const doc = readJson(join(dir, 'questions.json'), 'questions.json')
  const errors = validateQuestions(doc)
  if (errors.length > 0) throw new QuizError('questions.json failed validation', errors)
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

export { QuizError, TYPES, validateQuestions }
