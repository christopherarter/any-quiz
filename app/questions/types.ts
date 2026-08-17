import type { AnswerValue, PublicQuestion, QuestionType } from '../../lib/types.ts'

export interface QuestionProps<Q extends PublicQuestion, V extends AnswerValue> {
  question: Q
  value: V | null
  onChange: (value: V) => void
}

export type Narrow<T extends QuestionType> = Extract<PublicQuestion, { type: T }>

// The one place a question type is tied to the shape of its answer. A component that
// declared the wrong value type would otherwise typecheck on its own and only fail where
// it is dispatched, which is much further from the mistake.
export type ValueFor<T extends QuestionType> = T extends 'multi'
  ? string[]
  : T extends 'blank' | 'match'
    ? Record<string, string>
    : string

export type Props<T extends QuestionType> = QuestionProps<Narrow<T>, ValueFor<T>>
