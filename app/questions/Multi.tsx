import { type ReactElement, useCallback } from 'react'
import type { Choice } from '../../lib/types.ts'
import type { Props } from './types.ts'

const NONE: string[] = []

interface BoxProps {
  choice: Choice
  checked: boolean
  onToggle: (id: string) => void
}

// Emitted in choice order rather than click order, so the same set of boxes always produces
// the same payload. Scoring compares sets, but a stable order keeps the saved draft, the
// autosave PUT, and the answers file from churning on a re-click.
function toggled(choices: Choice[], selected: string[], id: string): string[] {
  const next = new Set(selected)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  return choices.map((choice) => choice.id).filter((candidate) => next.has(candidate))
}

function Box({ choice, checked, onToggle }: BoxProps): ReactElement {
  const handleChange = useCallback(() => {
    onToggle(choice.id)
  }, [choice.id, onToggle])

  return (
    <label className="opt">
      <input checked={checked} onChange={handleChange} type="checkbox" value={choice.id} />
      {choice.text}
    </label>
  )
}

export function Multi({ question, value, onChange }: Props<'multi'>): ReactElement {
  const selected = value ?? NONE
  const handleToggle = useCallback(
    (id: string) => {
      onChange(toggled(question.choices, selected, id))
    },
    [onChange, question.choices, selected],
  )

  return (
    <div>
      {question.choices.map((choice) => (
        <Box
          checked={selected.includes(choice.id)}
          choice={choice}
          key={choice.id}
          onToggle={handleToggle}
        />
      ))}
    </div>
  )
}
