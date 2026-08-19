import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { type ReactElement, useCallback, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Blank } from './Blank.tsx'
import type { Narrow } from './types.ts'

const BLANK_COUNT = 2

const hinted: Narrow<'blank'> = {
  id: 'q3',
  type: 'blank',
  prompt: 'A binary heap is a {{shape}} tree stored in an {{store}}.',
  blanks: [
    { id: 'shape', hint: 'shape property' },
    { id: 'store', hint: 'backing structure' },
  ],
}

const unhinted: Narrow<'blank'> = {
  id: 'q4',
  type: 'blank',
  prompt: 'Heapify runs in {{cost}} time.',
  blanks: [{ id: 'cost' }],
}

interface HarnessProps {
  question: Narrow<'blank'>
  initial: Record<string, string> | null
  onChange: (filled: Record<string, string>) => void
}

// A real keystroke only survives because the parent stores what the component reported and
// hands it straight back: the input is controlled, so React overwrites anything the DOM kept
// on its own. Driving `Blank` from a `vi.fn()` alone would test a component whose value never
// advances past one character, which is not how the quiz page renders it.
function Harness({ question, initial, onChange }: HarnessProps): ReactElement {
  const [stored, setStored] = useState<Record<string, string> | null>(initial)
  const handleChange = useCallback(
    (next: Record<string, string>) => {
      setStored(next)
      onChange(next)
    },
    [onChange],
  )

  return <Blank onChange={handleChange} question={question} value={stored} />
}

test('renders the prompt text around one input per blank', () => {
  render(<Blank onChange={vi.fn()} question={hinted} value={null} />)

  expect(screen.getAllByRole('textbox')).toHaveLength(BLANK_COUNT)
  expect(screen.getByText(/A binary heap is a/)).toBeDefined()
  expect(screen.getByText(/tree stored in an/)).toBeDefined()
})

test('a blank with a hint shows it as the placeholder', () => {
  render(<Blank onChange={vi.fn()} question={hinted} value={null} />)

  expect(screen.getByPlaceholderText('shape property')).toBeDefined()
})

test('a blank without a hint is still labelled', () => {
  render(<Blank onChange={vi.fn()} question={unhinted} value={null} />)

  expect(screen.getByLabelText('blank cost')).toBeDefined()
})

test('typing in a blank reports a record keyed by blank id', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness initial={null} onChange={onChange} question={hinted} />)

  await user.type(screen.getByPlaceholderText('backing structure'), 'array')

  expect(onChange).toHaveBeenLastCalledWith({ store: 'array' })
})

test('typing in a second blank preserves the first', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness initial={{ shape: 'complete' }} onChange={onChange} question={hinted} />)

  await user.type(screen.getByPlaceholderText('backing structure'), 'an array')

  expect(onChange).toHaveBeenLastCalledWith({ shape: 'complete', store: 'an array' })
})

test('the supplied value populates the inputs', () => {
  render(
    <Blank onChange={vi.fn()} question={hinted} value={{ shape: 'complete', store: 'array' }} />,
  )

  expect(screen.getByPlaceholderText<HTMLInputElement>('shape property').value).toBe('complete')
  expect(screen.getByPlaceholderText<HTMLInputElement>('backing structure').value).toBe('array')
})

test('a prompt that opens with a blank still renders every input', () => {
  const leading: Narrow<'blank'> = {
    id: 'q5',
    type: 'blank',
    prompt: '{{first}} is the root of a max-heap.',
    blanks: [{ id: 'first', hint: 'the largest key' }],
  }
  render(<Blank onChange={vi.fn()} question={leading} value={null} />)

  expect(screen.getByPlaceholderText('the largest key')).toBeDefined()
  expect(screen.getByText(/is the root of a max-heap/)).toBeDefined()
})
