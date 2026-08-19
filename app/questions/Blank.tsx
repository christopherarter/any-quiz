import { type ChangeEvent, type ReactElement, useCallback } from 'react'
import { parseBlanks, type Segment } from '../lib/blanks.ts'
import type { Props } from './types.ts'

const NONE: Record<string, string> = {}

interface FieldProps {
  id: string
  hint: string
  value: string
  onFill: (id: string, text: string) => void
}

interface PieceProps {
  segment: Segment
  hints: Map<string, string>
  filled: Record<string, string>
  onFill: (id: string, text: string) => void
}

// The inputs sit inside the sentence, so there is nowhere to put a visible label. Without
// this a screen reader announces the whole prompt as one run of text with unnamed edit
// fields in it, and there is no way to tell which blank is which.
function labelFor(id: string, hint: string): string {
  if (hint === '') {
    return `blank ${id}`
  }
  return `blank ${id}: ${hint}`
}

function Field({ id, hint, value, onFill }: FieldProps): ReactElement {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      onFill(id, event.target.value)
    },
    [id, onFill],
  )

  return (
    <input
      aria-label={labelFor(id, hint)}
      className="blank"
      onChange={handleChange}
      placeholder={hint}
      type="text"
      value={value}
    />
  )
}

function Piece({ segment, hints, filled, onFill }: PieceProps): ReactElement {
  if (segment.kind === 'text') {
    return <span>{segment.value}</span>
  }
  const hint = hints.get(segment.id) ?? ''
  return <Field hint={hint} id={segment.id} onFill={onFill} value={filled[segment.id] ?? ''} />
}

export function Blank({ question, value, onChange }: Props<'blank'>): ReactElement {
  const filled = value ?? NONE
  const hints = new Map(question.blanks.map((blank) => [blank.id, blank.hint ?? '']))
  const handleFill = useCallback(
    (id: string, text: string) => {
      onChange({ ...filled, [id]: text })
    },
    [filled, onChange],
  )

  return (
    <p className="q-prompt">
      {parseBlanks(question.prompt).map((segment, index) => (
        <Piece
          filled={filled}
          hints={hints}
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positions in one fixed prompt string, never reordered, inserted, or removed, so the index is the identity
          key={index}
          onFill={handleFill}
          segment={segment}
        />
      ))}
    </p>
  )
}
