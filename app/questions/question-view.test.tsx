import { render, screen } from '@testing-library/react'
// Named, not default: `verbatimModuleSyntax` keeps the import as written, and this
// package's default export resolves to the module namespace under this config, so
// `userEvent.type` does not typecheck through the default binding.
import { userEvent } from '@testing-library/user-event'
import { type ReactElement, useState } from 'react'
import { expect, test } from 'vitest'
import type { AnswerValue, PublicQuestion } from '../../lib/types.ts'
import { QuestionView } from './QuestionView.tsx'
import type { Narrow } from './types.ts'

// Built as typed literals rather than cast from JSON: `Narrow<'short'>` is the exact
// public shape, so a drift in the Question union breaks this file at compile time instead
// of at runtime. Importing the real fixture is not an option here -- `noNodejsModules` is
// deliberately still on under `app/`, which is browser code.
const mcq: Narrow<'mcq'> = {
  id: 'q1',
  type: 'mcq',
  prompt: 'Which is a heap property?',
  choices: [
    { id: 'a', text: 'sorted' },
    { id: 'b', text: 'partially ordered' },
  ],
}
const multi: Narrow<'multi'> = {
  id: 'q2',
  type: 'multi',
  prompt: 'Which are logarithmic?',
  choices: [
    { id: 'a', text: 'insert' },
    { id: 'b', text: 'peek' },
  ],
}
const blank: Narrow<'blank'> = {
  id: 'q3',
  type: 'blank',
  prompt: 'A heap is a {{1}} tree in an {{2}}.',
  blanks: [{ id: '1' }, { id: '2' }],
}
const short: Narrow<'short'> = {
  id: 'q4',
  type: 'short',
  prompt: 'Why does heapify ignore input order?',
}
const code: Narrow<'code'> = {
  id: 'q5',
  type: 'code',
  prompt: 'Write siftDown.',
  language: 'ts',
}
const match: Narrow<'match'> = {
  id: 'q6',
  type: 'match',
  prompt: 'Match operation to cost.',
  left: [{ id: 'l1', text: 'insert' }],
  right: [{ id: 'r1', text: 'O(log n)' }],
}

const ALL: PublicQuestion[] = [mcq, multi, blank, short, code, match]

const noop = (): void => undefined

// Holds the value in state the way the real page does. Rendering with a fixed `value` and
// spying on onChange would assert far less: these renderers are controlled, so with the
// prop pinned every keystroke reports a single character and the input never accumulates.
// Only feeding the reported value back proves the two halves of the contract line up.
function Harness({ question }: { question: PublicQuestion }): ReactElement {
  const [value, setValue] = useState<AnswerValue | null>(null)
  return <QuestionView onChange={setValue} question={question} value={value} />
}

// Proves every member of the union has a renderer wired up. The dispatcher's switch has no
// default branch, so a seventh type is already a compile error -- this covers the other
// direction, that each existing branch actually mounts something.
test('every question type renders without crashing', () => {
  for (const question of ALL) {
    const { container, unmount } = render(
      <QuestionView onChange={noop} question={question} value={null} />,
    )
    // Checks that an element mounted, not that it produced text: a renderer built from
    // form controls has no textContent at all, so a text-based probe would pass only for
    // the placeholder paragraphs and start failing as each real renderer lands.
    expect(container.childElementCount, `nothing rendered for ${question.type}`).toBeGreaterThan(0)
    unmount()
  }
})

test('short renders a textbox holding the stored value', () => {
  render(<QuestionView onChange={noop} question={short} value="because it builds bottom-up" />)
  expect(screen.getByRole('textbox')).toHaveProperty('value', 'because it builds bottom-up')
})

test('short accumulates what the user types', async () => {
  render(<Harness question={short} />)
  const box = screen.getByRole('textbox')
  await userEvent.type(box, 'hi')
  expect(box).toHaveProperty('value', 'hi')
})

// Drafts round-trip through JSON on disk, so a stored value can arrive shaped for a
// different question type than the one now rendering. Passing it through untouched is
// what a registry of `(props: any) => Element` would do, and the damage is not uniform:
// a string reaching the multi renderer would make `includes` match substrings, and
// reaching the blank renderer would index a string by blank id. Coercing to null at the
// dispatch boundary means the worst case is an empty input the user can just fill in.
test('a value shaped for another question type is discarded, not rendered', () => {
  render(<QuestionView onChange={noop} question={short} value={['a', 'b']} />)
  const box = screen.getByRole('textbox')
  expect(box).toHaveProperty('value', '')
  expect(box).not.toHaveProperty('value', 'a,b')
})

test('a scalar value is discarded for the types that expect a map or a list', () => {
  const { container: blankBox } = render(
    <QuestionView onChange={noop} question={blank} value="not a map" />,
  )
  expect(blankBox.textContent).not.toContain('not a map')

  const { container: multiBox } = render(
    <QuestionView onChange={noop} question={multi} value="ab" />,
  )
  expect(multiBox.textContent).not.toContain('ab')
})
