import { render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { type ReactElement, useCallback, useState } from 'react'
import { expect, test, vi } from 'vitest'
import { Code } from './Code.tsx'
import type { Narrow } from './types.ts'

const CARET = 2
const AFTER_INDENT = 4

const question: Narrow<'code'> = {
  id: 'q5',
  type: 'code',
  language: 'typescript',
  prompt: 'Write the parent index of node i.',
}

interface HarnessProps {
  initial: string | null
  onChange: (source: string) => void
}

// Controlled textarea: without a parent that stores what was reported, React restores the
// DOM on every keystroke and only the last character survives. See short.test.tsx.
function Harness({ initial, onChange }: HarnessProps): ReactElement {
  const [stored, setStored] = useState<string | null>(initial)
  const handleChange = useCallback(
    (next: string) => {
      setStored(next)
      onChange(next)
    },
    [onChange],
  )

  return <Code onChange={handleChange} question={question} value={stored} />
}

test('shows the language and a monospace textarea', () => {
  render(<Code onChange={vi.fn()} question={question} value={null} />)

  expect(screen.getByText('typescript')).toBeDefined()
  expect(screen.getByRole('textbox').className).toContain('code')
})

test('typing reports the source', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness initial={null} onChange={onChange} />)

  await user.type(screen.getByRole('textbox'), 'const parent = ')

  expect(onChange).toHaveBeenLastCalledWith('const parent = ')
})

test('the supplied value populates the editor', () => {
  render(<Code onChange={vi.fn()} question={question} value="const x = 1" />)

  expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('const x = 1')
})

test('Tab indents at the caret instead of moving focus', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Code onChange={onChange} question={question} value="ab" />)

  const area = screen.getByRole<HTMLTextAreaElement>('textbox')
  area.focus()
  area.setSelectionRange(CARET, CARET)
  await user.tab()

  expect(onChange).toHaveBeenLastCalledWith('ab  ')
  expect(document.activeElement).toBe(area)
})

test('Tab replaces the selected text rather than duplicating it', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Code onChange={onChange} question={question} value="abcd" />)

  const area = screen.getByRole<HTMLTextAreaElement>('textbox')
  area.focus()
  area.setSelectionRange(0, CARET)
  await user.tab()

  expect(onChange).toHaveBeenLastCalledWith('  cd')
})

test('Shift+Tab still leaves the editor', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Code onChange={onChange} question={question} value="ab" />)

  const area = screen.getByRole<HTMLTextAreaElement>('textbox')
  area.focus()
  await user.tab({ shift: true })

  // Tab is captured for indentation, so Shift+Tab is the only way out of the editor with a
  // keyboard. Capturing it too would trap the user in the question.
  expect(document.activeElement).not.toBe(area)
  expect(onChange).not.toHaveBeenCalled()
})

test('the caret stays where the indent was inserted', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness initial="abcd" onChange={onChange} />)

  const area = screen.getByRole<HTMLTextAreaElement>('textbox')
  area.focus()
  area.setSelectionRange(CARET, CARET)
  await user.tab()

  expect(area.value).toBe('ab  cd')
  expect(area.selectionStart).toBe(AFTER_INDENT)
})
