import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { type ReactElement, useCallback, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Short } from './Short.tsx'
import type { Narrow } from './types.ts'

const question: Narrow<'short'> = {
  id: 'q4',
  type: 'short',
  prompt: 'Why does heapify skip the second half of the array?',
}

interface HarnessProps {
  initial: string | null
  onChange: (text: string) => void
}

// The textarea is controlled, so React overwrites whatever the DOM kept between keystrokes.
// Driven by a bare mock the value never advances past one character; only a parent that
// stores what was reported and hands it back -- which is what `useQuiz` does -- lets a word
// accumulate.
function Harness({ initial, onChange }: HarnessProps): ReactElement {
  const [stored, setStored] = useState<string | null>(initial)
  const handleChange = useCallback(
    (next: string) => {
      setStored(next)
      onChange(next)
    },
    [onChange],
  )

  return <Short onChange={handleChange} question={question} value={stored} />
}

test('typing reports the full text', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness initial={null} onChange={onChange} />)

  await user.type(screen.getByRole('textbox'), 'the leaves are already heaps')

  expect(onChange).toHaveBeenLastCalledWith('the leaves are already heaps')
})

test('the supplied value populates the textarea', () => {
  render(<Short onChange={vi.fn()} question={question} value="prior draft" />)

  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('prior draft')
})

test('the prompt names the textarea for a screen reader', () => {
  render(<Short onChange={vi.fn()} question={question} value={null} />)

  expect(screen.getByLabelText(question.prompt)).toBeDefined()
})

test('clearing the draft reports an empty answer', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness initial="prior draft" onChange={onChange} />)

  await user.clear(screen.getByRole('textbox'))

  expect(onChange).toHaveBeenLastCalledWith('')
})
