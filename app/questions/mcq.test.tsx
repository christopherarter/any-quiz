import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Mcq } from './Mcq.tsx'
import type { Narrow } from './types.ts'

const CHOICE_COUNT = 3
const QUESTION_COUNT = 2

const question: Narrow<'mcq'> = {
  id: 'q1',
  type: 'mcq',
  prompt: 'Average-case complexity of heapsort?',
  choices: [
    { id: 'a', text: 'O(n)' },
    { id: 'b', text: 'O(n log n)' },
    { id: 'c', text: 'O(n^2)' },
  ],
}

test('renders one radio per choice', () => {
  render(<Mcq onChange={vi.fn()} question={question} value={null} />)

  expect(screen.getAllByRole('radio')).toHaveLength(CHOICE_COUNT)
})

test('clicking a choice reports its id', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Mcq onChange={onChange} question={question} value={null} />)

  await user.click(screen.getByLabelText('O(n log n)'))

  expect(onChange).toHaveBeenCalledExactlyOnceWith('b')
})

test('the supplied value is the checked radio', () => {
  render(<Mcq onChange={vi.fn()} question={question} value="c" />)

  expect(screen.getByLabelText<HTMLInputElement>('O(n^2)').checked).toBe(true)
  expect(screen.getByLabelText<HTMLInputElement>('O(n)').checked).toBe(false)
})

test('picking a second choice replaces the first', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Mcq onChange={onChange} question={question} value="a" />)

  await user.click(screen.getByLabelText('O(n log n)'))

  expect(onChange).toHaveBeenCalledExactlyOnceWith('b')
})

test('each question gets its own radio group', () => {
  const other: Narrow<'mcq'> = { ...question, id: 'q2' }
  render(
    <>
      <Mcq onChange={vi.fn()} question={question} value={null} />
      <Mcq onChange={vi.fn()} question={other} value={null} />
    </>,
  )

  const groups = new Set(screen.getAllByRole<HTMLInputElement>('radio').map((radio) => radio.name))

  // Radios are exclusive within a `name`. Unnamed radios are each their own group, so a
  // question would accept two answers at once; a shared name would make picking an answer in
  // one question clear the answer in the other.
  expect(groups.size).toBe(QUESTION_COUNT)
  expect(groups.has('')).toBe(false)
})
