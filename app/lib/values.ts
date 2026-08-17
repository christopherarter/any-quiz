import type { AnswerValue } from '../../lib/types.ts'

// Answers are persisted as JSON and read back without per-type validation, so a stored
// value can arrive shaped for a question type other than the one now asking for it -- a
// draft saved before the quiz was edited, or a hand-edited answers.json. These narrow to
// null rather than coercing, so a mismatched value reads as "not answered yet" instead of
// being reinterpreted as something the user never entered.

export function asString(value: AnswerValue | null): string | null {
  if (typeof value === 'string') {
    return value
  }
  return null
}

export function asList(value: AnswerValue | null): string[] | null {
  if (Array.isArray(value)) {
    return value
  }
  return null
}

export function asMap(value: AnswerValue | null): Record<string, string> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value
  }
  return null
}
