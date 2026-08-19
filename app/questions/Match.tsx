import { type ChangeEvent, type ReactElement, useCallback } from 'react'
import type { Choice } from '../../lib/types.ts'
import type { Props } from './types.ts'

const NONE: Record<string, string> = {}
const UNSET = ''
const PLACEHOLDER = 'choose…'
const DASH = '—'

interface RowProps {
  left: Choice
  options: Choice[]
  chosen: string
  onPair: (leftId: string, rightId: string) => void
}

// Going back to the placeholder drops the key instead of storing an empty string: scoring
// compares the saved map against the key, where a blank reads as a wrong answer, and
// `isAnswered` counts a left item as done only while its key is present and non-blank.
function paired(
  current: Record<string, string>,
  leftId: string,
  rightId: string,
): Record<string, string> {
  const rest = Object.fromEntries(Object.entries(current).filter(([id]) => id !== leftId))
  if (rightId === UNSET) {
    return rest
  }
  return { ...rest, [leftId]: rightId }
}

function Row({ left, options, chosen, onPair }: RowProps): ReactElement {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      onPair(left.id, event.target.value)
    },
    [left.id, onPair],
  )

  return (
    <div className="match-row">
      <span>{left.text}</span>
      <span aria-hidden="true">{DASH}</span>
      <select aria-label={`match for ${left.text}`} onChange={handleChange} value={chosen}>
        <option value={UNSET}>{PLACEHOLDER}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.text}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Match({ question, value, onChange }: Props<'match'>): ReactElement {
  const current = value ?? NONE
  const handlePair = useCallback(
    (leftId: string, rightId: string) => {
      onChange(paired(current, leftId, rightId))
    },
    [current, onChange],
  )

  return (
    <div>
      {question.left.map((left) => (
        <Row
          chosen={current[left.id] ?? UNSET}
          key={left.id}
          left={left}
          onPair={handlePair}
          options={question.right}
        />
      ))}
    </div>
  )
}
