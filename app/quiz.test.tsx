import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Answers, Meta, PublicQuestion, ResponseEntry } from '../lib/types.ts'
import { Quiz } from './Quiz.tsx'

const OK_STATUS = 200
const NO_CONTENT_STATUS = 204
const SERVER_ERROR_STATUS = 500
const FIRST_ERROR_STATUS = 300
// Comfortably past the hook's debounce window, so the flush is the timer firing rather
// than a race the test happens to win.
const PAST_AUTOSAVE_MS = 600

const META: Meta = {
  id: 'a3f9',
  slug: 'all-types',
  title: 'All Question Types',
  topic: 'a fixture',
  createdAt: '2026-08-17T00:00:00.000Z',
  parentQuizId: null,
  targets: [],
}
const SET_META: Meta = { ...META, id: 'b7c2', kind: 'set' }
const QUESTIONS: PublicQuestion[] = [
  { id: 'q1', type: 'short', prompt: 'First question?' },
  { id: 'q2', type: 'short', prompt: 'Second question?' },
]

function draft(responses: Record<string, ResponseEntry>, order?: string[]): Answers {
  return {
    quizId: META.id,
    status: 'draft',
    startedAt: META.createdAt,
    updatedAt: META.createdAt,
    submittedAt: null,
    responses,
    ...(order === undefined ? {} : { order }),
  }
}

// Minimal stand-in for Response: the hook only reads `ok`, `status`, and `json()`, and
// building it by hand keeps these tests independent of whether the jsdom environment
// happens to expose the fetch classes.
function reply(status: number, body: unknown): unknown {
  return { ok: status < FIRST_ERROR_STATUS, status, json: () => Promise.resolve(body) }
}

let puts: Record<string, ResponseEntry>[]
let submits: number
let finishes: number
let answers: Answers
let currentMeta: Meta
let submitResult: unknown
let quizStatus: number
let putStatus: number
let submitStatus: number

beforeEach(() => {
  puts = []
  submits = 0
  finishes = 0
  answers = draft({})
  currentMeta = META
  submitResult = { ok: true }
  quizStatus = OK_STATUS
  putStatus = NO_CONTENT_STATUS
  submitStatus = OK_STATUS
  // shouldAdvanceTime keeps Testing Library's own polling alive while the debounce timer
  // stays under the test's control; without it `findBy*` would wait on an interval that
  // never fires.
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/quiz') {
      return Promise.resolve(reply(quizStatus, { meta: currentMeta, questions: QUESTIONS }))
    }
    if (url === '/api/answers' && method === 'GET') {
      return Promise.resolve(reply(OK_STATUS, answers))
    }
    if (url === '/api/answers') {
      const body = JSON.parse(String(init?.body)) as { responses: Record<string, ResponseEntry> }
      puts.push(body.responses)
      return Promise.resolve(reply(putStatus, null))
    }
    if (url === '/api/submit') {
      submits += 1
      return Promise.resolve(reply(submitStatus, submitResult))
    }
    if (url === '/api/finish') {
      finishes += 1
      return Promise.resolve(reply(OK_STATUS, { ok: true }))
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function typist(): ReturnType<typeof userEvent.setup> {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

async function settleAutosave(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAST_AUTOSAVE_MS)
  })
}

test('renders the quiz title and one card per question', async () => {
  render(<Quiz />)
  expect(await screen.findByText('All Question Types')).toBeDefined()
  expect(screen.getByText('a fixture')).toBeDefined()
  expect(screen.getByText('First question?')).toBeDefined()
  expect(screen.getByText('Second question?')).toBeDefined()
})

test('progress starts at zero and counts answered questions', async () => {
  const user = typist()
  render(<Quiz />)
  expect(await screen.findByText(/0\/2 answered/)).toBeDefined()
  await user.type(screen.getAllByRole('textbox')[0] as HTMLElement, 'an answer')
  expect(await screen.findByText(/1\/2 answered/)).toBeDefined()
})

// The debounce coalesces edits, so it has to coalesce them per question. A single
// "latest edit" timer drops the earlier question entirely: typing into q1 and then
// flagging q2 inside one window would leave q1's answer only in memory, which is
// exactly the draft an interrupted session needs back.
test('autosave batches every question touched inside one debounce window', async () => {
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)

  await user.type(screen.getAllByRole('textbox')[0] as HTMLElement, 'hi')
  await user.click(screen.getAllByRole('button', { name: /not sure/i })[1] as HTMLElement)
  expect(puts, 'saved before the debounce elapsed').toHaveLength(0)

  await settleAutosave()
  await waitFor(() => {
    expect(puts).toHaveLength(1)
  })
  expect(puts[0]).toEqual({
    q1: { value: 'hi', flagged: false },
    q2: { value: null, flagged: true },
  })
})

test('flagging a question updates the footer', async () => {
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)
  await user.click(screen.getAllByRole('button', { name: /not sure/i })[0] as HTMLElement)
  expect(await screen.findByText(/1 flagged/)).toBeDefined()
})

test('done asks before sending a quiz with unanswered questions', async () => {
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)
  await user.click(screen.getByRole('button', { name: /^done$/i }))
  expect(await screen.findByText(/2 unanswered/i)).toBeDefined()
  expect(submits, 'sent without confirming').toBe(0)
})

test('backing out of the confirmation leaves the quiz editable', async () => {
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)
  await user.click(screen.getByRole('button', { name: /^done$/i }))
  await user.click(await screen.findByRole('button', { name: /keep working/i }))
  expect(screen.queryByText(/2 unanswered/i)).toBeNull()
  expect(screen.getByRole('button', { name: /^done$/i })).toBeDefined()
  expect(submits).toBe(0)
})

test('confirming sends the answers and shows the post-submit view', async () => {
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)
  await user.click(screen.getByRole('button', { name: /^done$/i }))
  await user.click(await screen.findByRole('button', { name: /send anyway/i }))
  expect(await screen.findByText(/sent back to Claude/i)).toBeDefined()
  expect(submits).toBe(1)
})

// A fully answered quiz skips the confirmation entirely -- the prompt exists to catch
// unfinished work, not to add a step to every submission.
test('a fully answered quiz submits on the first click', async () => {
  answers = draft({
    q1: { value: 'one', flagged: false },
    q2: { value: 'two', flagged: false },
  })
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/2\/2 answered/)
  await user.click(screen.getByRole('button', { name: /^done$/i }))
  expect(await screen.findByText(/sent back to Claude/i)).toBeDefined()
  expect(puts.at(-1)).toEqual(answers.responses)
})

// `await fetch(...)` resolves for a 500 as readily as a 204, so a submit that never
// reached disk would otherwise render the same "sent back to Claude" screen as one that
// did -- and the user would close the tab believing the work was delivered.
test('a rejected submit keeps the user on the quiz and says so', async () => {
  submitStatus = SERVER_ERROR_STATUS
  answers = draft({
    q1: { value: 'one', flagged: false },
    q2: { value: 'two', flagged: false },
  })
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/2\/2 answered/)
  await user.click(screen.getByRole('button', { name: /^done$/i }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('not sent'),
  )
  expect(screen.queryByText(/sent back to Claude/i)).toBeNull()
  expect(screen.getByRole('button', { name: /^done$/i })).toBeDefined()
})

test('a quiz that fails to load reports it instead of spinning forever', async () => {
  quizStatus = SERVER_ERROR_STATUS
  render(<Quiz />)
  expect(await screen.findByRole('alert')).toBeDefined()
  expect(screen.queryByText(/loading/i)).toBeNull()
})

// Reopening the tab after submitting must not offer a second attempt: the server answers
// a repeat submit with 409, so the browser has to know the attempt is closed.
test('answers already submitted open in the post-submit view', async () => {
  answers = { ...draft({}), status: 'submitted', submittedAt: META.createdAt }
  render(<Quiz />)
  expect(await screen.findByText(/sent back to Claude/i)).toBeDefined()
  expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull()
})

// Both clicks land before any promise continuation runs, so only something applied during
// the first click can stop the second. A duplicate reaches the server as a 409, because the
// attempt is already closed by then.
test('done cannot be fired twice into a duplicate submission', async () => {
  answers = draft({
    q1: { value: 'one', flagged: false },
    q2: { value: 'two', flagged: false },
  })
  render(<Quiz />)
  await screen.findByText(/2\/2 answered/)
  const done = screen.getByRole('button', { name: /^done$/i })
  fireEvent.click(done)
  fireEvent.click(done)
  await screen.findByText(/sent back to Claude/i)
  expect(submits).toBe(1)
})

test('questions render in answers.order when the server provides one', async () => {
  answers = draft({}, ['q2', 'q1'])
  render(<Quiz />)
  const prompts = await screen.findAllByText(/question\?$/)
  expect(prompts.map((el) => el.textContent)).toEqual(['Second question?', 'First question?'])
})

test('a set shows "Check answers" instead of "Done" before the first run', async () => {
  currentMeta = SET_META
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)
  expect(screen.getByRole('button', { name: /check answers/i })).toBeDefined()
  expect(screen.queryByRole('button', { name: /^done$/i })).toBeNull()
})

test('submitting a set shows the score and Run again / Finish studying, not the terminal screen', async () => {
  currentMeta = SET_META
  submitResult = {
    ok: true,
    result: { correct: 1, total: 2, perQuestion: { q1: true, q2: false } },
  }
  answers = draft({
    q1: { value: 'one', flagged: false },
    q2: { value: 'two', flagged: false },
  })
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/2\/2 answered/)
  await user.click(screen.getByRole('button', { name: /check answers/i }))
  expect(await screen.findByText('1/2')).toBeDefined()
  expect(screen.getByRole('button', { name: /run again/i })).toBeDefined()
  expect(screen.getByRole('button', { name: /finish studying/i })).toBeDefined()
  expect(screen.queryByText(/sent back to Claude/i)).toBeNull()
  expect(submits).toBe(1)
})

test('run again clears the score; the editor was already refreshed by the submit itself', async () => {
  currentMeta = SET_META
  submitResult = { ok: true, result: { correct: 2, total: 2, perQuestion: { q1: true, q2: true } } }
  answers = draft({
    q1: { value: 'one', flagged: false },
    q2: { value: 'two', flagged: false },
  })
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/2\/2 answered/)

  // The real server resets and reshuffles answers.json as part of scoring the submit;
  // reassigning here before the click stands in for that, since the mock has no server.
  answers = draft({}, ['q2', 'q1'])

  await user.click(screen.getByRole('button', { name: /check answers/i }))
  await screen.findByText('2/2')
  expect(await screen.findByText(/0\/2 answered/)).toBeDefined()

  await user.click(screen.getByRole('button', { name: /run again/i }))
  expect(screen.queryByText('2/2')).toBeNull()
  expect(screen.getByRole('button', { name: /check answers/i })).toBeDefined()
})

test('finish studying sends /api/finish and shows the terminal screen', async () => {
  currentMeta = SET_META
  submitResult = { ok: true, result: { correct: 2, total: 2, perQuestion: { q1: true, q2: true } } }
  const user = typist()
  render(<Quiz />)
  await screen.findByText(/0\/2 answered/)
  await user.click(screen.getByRole('button', { name: /check answers/i }))
  await screen.findByText('2/2')
  await user.click(screen.getByRole('button', { name: /finish studying/i }))
  expect(await screen.findByText(/sent back to Claude/i)).toBeDefined()
  expect(finishes).toBe(1)
})
