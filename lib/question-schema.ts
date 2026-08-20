import { z } from 'zod'
import type { QuestionType } from './types.ts'

// Validation runs over untrusted JSON, so everything here is `unknown`-shaped on
// purpose. `Loose` is the shape we probe before we are entitled to a Question.
type Loose = Record<string, unknown>

const TYPES: QuestionType[] = ['mcq', 'multi', 'blank', 'short', 'code', 'match']

const placeholders = (prompt: string): string[] =>
  [...prompt.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] as string)

const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')

const firstIssue = (result: z.ZodSafeParseError<unknown>): string =>
  result.error.issues[0]?.message ?? 'invalid'

// A bare `.min(1, message)` only covers the too-short case: an entirely wrong-typed or
// missing value fails zod's own `invalid_type` check first, with zod's default message.
// Passing `message` to `z.string()` itself too covers both failure modes with one message.
function requiredString(message: string) {
  return z.string({ error: () => message }).min(1, message)
}

function choiceListSchema(field: string) {
  const shapeMessage = `${field} must be an array of at least 2 entries`
  const entryMessage = `every ${field} entry needs a non-empty id and text`
  const entry = z.object({
    id: requiredString(entryMessage),
    text: requiredString(entryMessage),
  })
  return z.array(entry, { error: () => shapeMessage }).min(2, shapeMessage)
}

const BLANKS_MESSAGE = 'blanks must be a non-empty array of {id, hint}'
const BlanksListSchema = z
  .array(z.object({ id: requiredString(BLANKS_MESSAGE), hint: z.string().optional() }), {
    error: () => BLANKS_MESSAGE,
  })
  .min(1, BLANKS_MESSAGE)

const mcqSchema = z
  .object({ choices: choiceListSchema('choices'), answer: z.unknown() })
  .superRefine((data, ctx) => {
    const { answer } = data
    if (!data.choices.some((c) => c.id === answer)) {
      ctx.addIssue({ code: 'custom', message: `answer "${String(answer)}" is not a choice id` })
    }
  })

const multiSchema = z
  .object({ choices: choiceListSchema('choices'), answer: z.unknown() })
  .superRefine((data, ctx) => {
    const { answer } = data
    if (!Array.isArray(answer) || answer.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'answer must be a non-empty array of choice ids' })
      return
    }
    const ids = data.choices.map((c) => c.id)
    for (const a of answer) {
      if (!ids.includes(a as string)) {
        ctx.addIssue({ code: 'custom', message: `answer "${String(a)}" is not a choice id` })
      }
    }
  })

function isAcceptList(accept: unknown): accept is string[] {
  return (
    Array.isArray(accept) &&
    accept.length > 0 &&
    accept.every((a) => typeof a === 'string' && a.trim().length > 0)
  )
}

const blankSchema = z
  .object({ prompt: z.string(), blanks: BlanksListSchema, answer: z.unknown() })
  .superRefine((data, ctx) => {
    const declared = data.blanks.map((b) => b.id)
    if (!sameSet(placeholders(data.prompt), declared)) {
      ctx.addIssue({
        code: 'custom',
        message: 'prompt placeholders {{n}} do not match the blanks array',
      })
      return
    }
    const { answer } = data
    if (
      answer === null ||
      typeof answer !== 'object' ||
      Array.isArray(answer) ||
      !sameSet(Object.keys(answer), declared)
    ) {
      ctx.addIssue({ code: 'custom', message: 'answer keys must match the blanks array' })
      return
    }
    for (const [id, accept] of Object.entries(answer as Record<string, unknown>)) {
      if (!isAcceptList(accept)) {
        ctx.addIssue({
          code: 'custom',
          message: `blank "${id}" needs a non-empty accept-list of strings`,
        })
      }
    }
  })

const shortSchema = z.object({ answer: z.unknown() }).superRefine((data, ctx) => {
  const { answer } = data
  if (typeof answer !== 'string' || answer.trim().length === 0) {
    ctx.addIssue({ code: 'custom', message: 'answer must be a non-empty reference answer' })
  }
})

const codeSchema = z
  .object({
    language: requiredString('code questions need a language'),
    answer: z.unknown(),
  })
  .superRefine((data, ctx) => {
    const { answer } = data
    if (typeof answer !== 'string' || answer.trim().length === 0) {
      ctx.addIssue({ code: 'custom', message: 'answer must be a non-empty reference solution' })
    }
  })

const matchSchema = z
  .object({ left: choiceListSchema('left'), right: choiceListSchema('right'), answer: z.unknown() })
  .superRefine((data, ctx) => {
    const leftIds = data.left.map((c) => c.id)
    const rightIds = data.right.map((c) => c.id)
    const { answer } = data
    if (
      answer === null ||
      typeof answer !== 'object' ||
      Array.isArray(answer) ||
      !sameSet(Object.keys(answer), leftIds)
    ) {
      ctx.addIssue({ code: 'custom', message: 'answer keys must match the left ids' })
      return
    }
    for (const [l, r] of Object.entries(answer as Record<string, unknown>)) {
      if (!rightIds.includes(r as string)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${l}" maps to "${String(r)}", which is not a right id`,
        })
      }
    }
  })

const QUESTION_SCHEMAS: Record<QuestionType, z.ZodType> = {
  mcq: mcqSchema,
  multi: multiSchema,
  blank: blankSchema,
  short: shortSchema,
  code: codeSchema,
  match: matchSchema,
}

const IdSchema = requiredString('missing id')
const PromptSchema = requiredString('missing prompt')
const TypeSchema = z.enum(TYPES as [QuestionType, ...QuestionType[]], {
  error: (issue) => `unknown type "${String(issue.input)}"`,
})

// Validates a single question and appends any problems to `out`. A non-string `type`,
// non-string `prompt`, or missing `answer` all stop before the per-type schema runs --
// that schema (e.g. blank's `.matchAll()` on `prompt`) assumes those basics already
// hold, and would throw on malformed input instead of reporting it.
function validateQuestion(raw: unknown, index: number, seen: Set<string>, out: string[]): void {
  const q = (raw ?? {}) as Loose

  const idResult = IdSchema.safeParse(q.id)
  if (!idResult.success) {
    out.push(`question #${index + 1}: ${firstIssue(idResult)}`)
    return
  }
  const { data: id } = idResult
  if (seen.has(id)) {
    out.push(`${id}: duplicate id`)
  }
  seen.add(id)

  const promptResult = PromptSchema.safeParse(q.prompt)
  if (!promptResult.success) {
    out.push(`${id}: ${firstIssue(promptResult)}`)
    return
  }

  const typeResult = TypeSchema.safeParse(q.type)
  if (!typeResult.success) {
    out.push(`${id}: ${firstIssue(typeResult)}`)
    return
  }

  if (q.answer === undefined) {
    out.push(`${id}: missing answer`)
    return
  }

  const result = QUESTION_SCHEMAS[typeResult.data].safeParse(q)
  if (!result.success) {
    for (const issue of result.error.issues) {
      out.push(`${id}: ${issue.message}`)
    }
  }
}

const RootSchema = z.looseObject({ version: z.unknown(), questions: z.unknown() })

function validateQuestions(doc: unknown): string[] {
  const rootResult = RootSchema.safeParse(doc)
  if (!rootResult.success) {
    return ['questions.json must be a JSON object']
  }
  const { version, questions } = rootResult.data
  const out: string[] = []

  const versionResult = z
    .literal(1, {
      error: (issue) => `unsupported version ${JSON.stringify(issue.input)}, expected 1`,
    })
    .safeParse(version)
  if (!versionResult.success) {
    out.push(firstIssue(versionResult))
  }

  const questionsMessage = 'questions must be an array with at least one entry'
  const questionsResult = z
    .array(z.unknown(), { error: () => questionsMessage })
    .min(1, questionsMessage)
    .safeParse(questions)
  if (!questionsResult.success) {
    out.push(firstIssue(questionsResult))
    return out
  }

  const seen = new Set<string>()
  for (const [i, entry] of questionsResult.data.entries()) {
    validateQuestion(entry, i, seen, out)
  }
  return out
}

export { TYPES, validateQuestions }
