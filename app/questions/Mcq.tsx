import { type ReactElement, useCallback } from 'react'
import type { Choice } from '../../lib/types.ts'
import type { Props } from './types.ts'

interface OptionProps {
  choice: Choice
  group: string
  checked: boolean
  onPick: (id: string) => void
}

function Option({ choice, group, checked, onPick }: OptionProps): ReactElement {
  const handleChange = useCallback(() => {
    onPick(choice.id)
  }, [choice.id, onPick])

  return (
    <label className="opt">
      <input
        checked={checked}
        name={group}
        onChange={handleChange}
        type="radio"
        value={choice.id}
      />
      {choice.text}
    </label>
  )
}

export function Mcq({ question, value, onChange }: Props<'mcq'>): ReactElement {
  // Sharing one `name` across the group is what makes the radios mutually exclusive, and it
  // has to be unique per question: two questions rendered on the same page with the same
  // name would deselect each other's answers.
  const group = `q-${question.id}`

  return (
    <div>
      {question.choices.map((choice) => (
        <Option
          checked={value === choice.id}
          choice={choice}
          group={group}
          key={choice.id}
          onPick={onChange}
        />
      ))}
    </div>
  )
}
