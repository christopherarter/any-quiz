import type { ReactElement } from 'react'
import type { AnswerValue, PublicQuestion } from '../../lib/types.ts'
import { asList, asMap, asString } from '../lib/values.ts'
import { Blank } from './Blank.tsx'
import { Code } from './Code.tsx'
import { Match } from './Match.tsx'
import { Mcq } from './Mcq.tsx'
import { Multi } from './Multi.tsx'
import { Short } from './Short.tsx'

interface QuestionViewProps {
  question: PublicQuestion
  value: AnswerValue | null
  onChange: (value: AnswerValue) => void
}

// The single place the question union is narrowed. A lookup table keyed by type cannot do
// this job without erasing the props to `any`, because each renderer takes a different
// question member and a different value shape -- and erasing them is exactly what would
// let a stored value of the wrong shape reach a component that assumes otherwise. Every
// branch coerces through app/lib/values.ts first, so a mismatch renders as empty.
//
// No default branch on purpose: a seventh question type fails `tsc` here, and the test
// beside this file covers the other direction, that each branch actually mounts something.
export function QuestionView({ question, value, onChange }: QuestionViewProps): ReactElement {
  // biome-ignore lint/style/useDefaultSwitchClause: exhaustive switch over the Question union by design; a default would silently render a future unhandled type as nothing instead of failing tsc
  switch (question.type) {
    case 'mcq':
      return <Mcq onChange={onChange} question={question} value={asString(value)} />
    case 'multi':
      return <Multi onChange={onChange} question={question} value={asList(value)} />
    case 'blank':
      return <Blank onChange={onChange} question={question} value={asMap(value)} />
    case 'short':
      return <Short onChange={onChange} question={question} value={asString(value)} />
    case 'code':
      return <Code onChange={onChange} question={question} value={asString(value)} />
    case 'match':
      return <Match onChange={onChange} question={question} value={asMap(value)} />
  }
}
