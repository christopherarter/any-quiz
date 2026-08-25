import type { PublicQuestion } from '../../lib/types.ts'

// A question id in `order` with no matching question (a stale id from a since-edited
// questions.json) is dropped rather than kept as undefined; a question missing from
// `order` (added after the last shuffle) is appended in its original position instead
// of vanishing from the page.
export function reorderQuestions(questions: PublicQuestion[], order?: string[]): PublicQuestion[] {
  if (order === undefined) {
    return questions
  }
  const byId = new Map(questions.map((question) => [question.id, question]))
  const ordered: PublicQuestion[] = []
  for (const id of order) {
    const question = byId.get(id)
    if (question !== undefined) {
      ordered.push(question)
    }
  }
  const seen = new Set(ordered.map((question) => question.id))
  const remaining = questions.filter((question) => !seen.has(question.id))
  return [...ordered, ...remaining]
}
