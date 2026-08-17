import { type ChangeEvent, type ReactElement, useCallback } from 'react'
import type { Props } from './types.ts'

export function Short({ question, value, onChange }: Props<'short'>): ReactElement {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value)
    },
    [onChange],
  )

  return (
    <textarea
      aria-label={question.prompt}
      onChange={handleChange}
      placeholder="Your answer…"
      value={value ?? ''}
    />
  )
}
