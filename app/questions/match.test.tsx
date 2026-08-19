import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Match } from './Match.tsx'
import type { Narrow } from './types.ts'

const LEFT_COUNT = 2

const question: Narrow<'match'> = {
  id: 'q6',
  type: 'match',
  prompt: 'Match the operation to its cost.',
  left: [
    { id: 'l1', text: 'peek max' },
    { id: 'l2', text: 'insert' },
  ],
  right: [
    { id: 'r1', text: 'O(1)' },
    { id: 'r2', text: 'O(log n)' },
  ],
}

test('renders one select per left item, each listing every right option', () => {
  render(<Match onChange={vi.fn()} question={question} value={null} />)

  expect(screen.getAllByRole('combobox')).toHaveLength(LEFT_COUNT)
  expect(screen.getAllByRole('option', { name: 'O(1)' })).toHaveLength(LEFT_COUNT)
})

test('every left item is shown next to its own dropdown', () => {
  render(<Match onChange={vi.fn()} question={question} value={null} />)

  expect(screen.getByText('peek max')).toBeDefined()
  expect(screen.getByLabelText(/match for peek max/i)).toBeDefined()
  expect(screen.getByLabelText(/match for insert/i)).toBeDefined()
})

test('choosing an option reports a left-to-right mapping', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Match onChange={onChange} question={question} value={null} />)

  await user.selectOptions(screen.getByLabelText(/match for peek max/i), 'r1')

  expect(onChange).toHaveBeenLastCalledWith({ l1: 'r1' })
})

test('a second choice preserves the first', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Match onChange={onChange} question={question} value={{ l1: 'r1' }} />)

  await user.selectOptions(screen.getByLabelText(/match for insert/i), 'r2')

  expect(onChange).toHaveBeenLastCalledWith({ l1: 'r1', l2: 'r2' })
})

test('the same right option may be reused across rows', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Match onChange={onChange} question={question} value={{ l1: 'r1' }} />)

  await user.selectOptions(screen.getByLabelText(/match for insert/i), 'r1')

  expect(onChange).toHaveBeenLastCalledWith({ l1: 'r1', l2: 'r1' })
})

test('going back to the placeholder drops that pairing', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Match onChange={onChange} question={question} value={{ l1: 'r1', l2: 'r2' }} />)

  await user.selectOptions(screen.getByLabelText(/match for peek max/i), '')

  expect(onChange).toHaveBeenLastCalledWith({ l2: 'r2' })
})

test('the supplied value preselects each dropdown', () => {
  render(<Match onChange={vi.fn()} question={question} value={{ l1: 'r2' }} />)

  expect(screen.getByLabelText<HTMLSelectElement>(/match for peek max/i).value).toBe('r2')
  expect(screen.getByLabelText<HTMLSelectElement>(/match for insert/i).value).toBe('')
})
