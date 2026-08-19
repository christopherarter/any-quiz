import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Multi } from './Multi.tsx'
import type { Narrow } from './types.ts'

const CHOICE_COUNT = 3

const question: Narrow<'multi'> = {
  id: 'q2',
  type: 'multi',
  prompt: 'Which are stable sorts?',
  choices: [
    { id: 'a', text: 'merge sort' },
    { id: 'b', text: 'heapsort' },
    { id: 'c', text: 'insertion sort' },
  ],
}

test('renders one checkbox per choice', () => {
  render(<Multi onChange={vi.fn()} question={question} value={null} />)

  expect(screen.getAllByRole('checkbox')).toHaveLength(CHOICE_COUNT)
})

test('reports ids in choice order regardless of click order', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  const { rerender } = render(<Multi onChange={onChange} question={question} value={null} />)

  await user.click(screen.getByLabelText('insertion sort'))
  expect(onChange).toHaveBeenLastCalledWith(['c'])

  rerender(<Multi onChange={onChange} question={question} value={['c']} />)
  await user.click(screen.getByLabelText('merge sort'))

  expect(onChange).toHaveBeenLastCalledWith(['a', 'c'])
})

test('unchecking removes the id', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Multi onChange={onChange} question={question} value={['a', 'c']} />)

  await user.click(screen.getByLabelText('merge sort'))

  expect(onChange).toHaveBeenLastCalledWith(['c'])
})

test('the supplied value checks the right boxes', () => {
  render(<Multi onChange={vi.fn()} question={question} value={['b']} />)

  expect(screen.getByLabelText<HTMLInputElement>('heapsort').checked).toBe(true)
  expect(screen.getByLabelText<HTMLInputElement>('merge sort').checked).toBe(false)
})

test('clearing the last box reports an empty selection', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Multi onChange={onChange} question={question} value={['b']} />)

  await user.click(screen.getByLabelText('heapsort'))

  expect(onChange).toHaveBeenLastCalledWith([])
})
