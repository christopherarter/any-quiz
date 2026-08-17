import type { AnswerValue, Question, QuestionType, ResponseEntry, ResultPayload } from './types.ts'

const CLOSED_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>([
  'mcq',
  'multi',
  'blank',
  'match',
])

function normalizeText(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function asStrings(v: AnswerValue): string[] {
  if (Array.isArray(v)) {
    return v
  }
  return []
}

function asRecord(v: AnswerValue): Record<string, string> {
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v
  }
  return {}
}

function scoreQuestion(question: Question, value: AnswerValue | null): boolean {
  if (value === null) {
    return false
  }
  // biome-ignore lint/style/useDefaultSwitchClause: exhaustive switch over the Question union by design; a default would silently score a future unhandled type as false instead of failing tsc
  switch (question.type) {
    case 'mcq':
      return value === question.answer
    case 'multi': {
      // Set comparison, not a sorted-join string comparison: a choice id containing
      // whatever separator a join used could make two different sets compare equal.
      const got = new Set(asStrings(value))
      const expected = new Set(question.answer)
      return got.size === expected.size && [...got].every((id) => expected.has(id))
    }
    case 'blank': {
      const got = asRecord(value)
      return Object.entries(question.answer).every(([id, accept]) => {
        const typed = got[id]
        return (
          typeof typed === 'string' && accept.some((a) => normalizeText(a) === normalizeText(typed))
        )
      })
    }
    case 'match': {
      const got = asRecord(value)
      return Object.entries(question.answer).every(([l, r]) => got[l] === r)
    }
    // `short` and `code` are graded by a human/model later, never here.
    case 'short':
    case 'code':
      return false
  }
}

function scoreQuiz(
  questions: Question[],
  responses: Record<string, ResponseEntry>,
): Pick<ResultPayload, 'auto' | 'needsGrading' | 'flagged'> {
  const perQuestion: Record<string, boolean> = {}
  const needsGrading: string[] = []
  const flagged: string[] = []
  let correct = 0
  let total = 0

  for (const question of questions) {
    const entry = responses[question.id]
    if (entry?.flagged === true) {
      flagged.push(question.id)
    }
    if (CLOSED_TYPES.has(question.type)) {
      total += 1
      const ok = scoreQuestion(question, entry?.value ?? null)
      perQuestion[question.id] = ok
      if (ok) {
        correct += 1
      }
    } else {
      needsGrading.push(question.id)
    }
  }

  return { auto: { correct, total, perQuestion }, needsGrading, flagged }
}

export { CLOSED_TYPES, normalizeText, scoreQuestion, scoreQuiz }
