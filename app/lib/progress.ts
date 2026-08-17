import type { AnswerValue, PublicQuestion, ResponseEntry } from '../../lib/types.ts'
import { asMap } from './values.ts'

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// A value shaped for a different question type becomes an empty record, so every key
// looks absent and the question reads as unanswered. That is the safe direction -- the
// opposite would let a quiz be submitted with a question the user never filled in.
// `asMap` is shared with the render path so both agree on what counts as a map.
function asRecord(value: AnswerValue): Record<string, string> {
  return asMap(value) ?? {}
}

// No `default` branch on purpose: adding a seventh question type must fail `tsc` here
// rather than silently report every instance of it as unanswered.
export function isAnswered(question: PublicQuestion, value: AnswerValue | null): boolean {
  if (value === null) {
    return false
  }
  // biome-ignore lint/style/useDefaultSwitchClause: exhaustive switch over the Question union by design; a default would silently report a future unhandled type as unanswered instead of failing tsc
  switch (question.type) {
    case 'mcq':
    case 'short':
    case 'code':
      return filled(value)
    case 'multi':
      return Array.isArray(value) && value.length > 0
    case 'blank':
      return question.blanks.every((b) => filled(asRecord(value)[b.id]))
    case 'match':
      return question.left.every((l) => filled(asRecord(value)[l.id]))
  }
}

// Iterates the questions rather than the responses: the map is empty on first render and
// stays sparse until every question is touched, so `total` has to come from the quiz.
export function summarize(
  questions: PublicQuestion[],
  responses: Record<string, ResponseEntry>,
): { answered: number; total: number; flagged: number } {
  let answered = 0
  let flagged = 0
  for (const question of questions) {
    const entry = responses[question.id]
    if (isAnswered(question, entry?.value ?? null)) {
      answered += 1
    }
    if (entry?.flagged === true) {
      flagged += 1
    }
  }
  return { answered, total: questions.length, flagged }
}
