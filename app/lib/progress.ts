import type { AnswerValue, PublicQuestion, ResponseEntry } from '../../lib/types.ts'

function filled(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

// Drafts round-trip through JSON on disk, so a stored value can arrive shaped for a
// different question type than the one now asking about it. Coercing anything that is not
// a plain object to `{}` makes every key look absent, which reads as unanswered -- the
// safe direction, since the opposite would let a quiz be submitted with a question the
// user never actually filled in.
function asRecord(value: AnswerValue): Record<string, string> {
  return typeof value === 'object' && !Array.isArray(value) ? value : {}
}

// No `default` branch on purpose: adding a seventh question type must fail `tsc` here
// rather than silently report every instance of it as unanswered.
export function isAnswered(question: PublicQuestion, value: AnswerValue | null): boolean {
  if (value === null) {
    return false
  }
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
