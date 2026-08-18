import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import type { Answers, AnswerValue, Meta, PublicQuestion, ResponseEntry } from '../lib/types.ts'

// Long enough that a burst of typing is one write, short enough that a draft is on disk
// before the user's attention moves on. An edit made inside the last window before the tab
// closes is lost -- a page teardown cannot be awaited -- and the alternative, writing on
// every keystroke, rewrites answers.json dozens of times per question.
const AUTOSAVE_MS = 500

const JSON_HEADERS = { 'content-type': 'application/json' }

const NEW_ENTRY: ResponseEntry = { value: null, flagged: false }

type Status = 'loading' | 'ready' | 'submitting' | 'submitted' | 'failed'

type Responses = Record<string, ResponseEntry>

interface QuizData {
  meta: Meta
  questions: PublicQuestion[]
}

interface Loaded extends QuizData {
  responses: Responses
  submitted: boolean
}

interface Autosave {
  queue: (id: string, entry: ResponseEntry) => void
  cancel: () => void
}

interface Editor {
  responses: Responses
  latest: RefObject<Responses>
  seed: (initial: Responses) => void
  setValue: (id: string, value: AnswerValue) => void
  toggleFlag: (id: string) => void
}

interface SubmitDeps {
  latest: RefObject<Responses>
  cancel: () => void
  setStatus: (status: Status) => void
  setError: (message: string | null) => void
}

function describe(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  return 'unexpected error'
}

// Every response is checked for `ok`. `fetch` resolves for a 500 exactly as it does for a
// 204, so without this a failed save or a failed submit is indistinguishable from a
// successful one, and the page reports work as delivered that never left the tab.
async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status}`)
  }
  return (await res.json()) as T
}

async function putResponses(responses: Responses): Promise<void> {
  const res = await fetch('/api/answers', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ responses }),
  })
  if (!res.ok) {
    throw new Error(`saving answers failed (${res.status})`)
  }
}

async function postSubmit(): Promise<void> {
  const res = await fetch('/api/submit', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`submitting failed (${res.status})`)
  }
}

// `onLoad` and `onFail` must be stable across renders -- they are effect dependencies, and
// an inline callback would refetch the quiz on every keystroke.
function useLoad(onLoad: (loaded: Loaded) => void, onFail: (message: string) => void): void {
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [quiz, saved] = await Promise.all([
        getJson<QuizData>('/api/quiz'),
        getJson<Answers>('/api/answers'),
      ])
      if (cancelled) {
        return
      }
      onLoad({ ...quiz, responses: saved.responses, submitted: saved.status === 'submitted' })
    }
    load().catch((err: unknown) => {
      if (cancelled) {
        return
      }
      onFail(describe(err))
    })
    return () => {
      cancelled = true
    }
  }, [onLoad, onFail])
}

function useAutosave(report: (message: string | null) => void): Autosave {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Entries edited since the last flush, keyed by question id. A single "latest edit" slot
  // would let a change to one question cancel a pending change to another whenever two are
  // touched inside the same window, dropping the first from disk with nothing to show it.
  const pending = useRef<Responses>({})

  const flush = useCallback(() => {
    const batch = pending.current
    pending.current = {}
    if (Object.keys(batch).length === 0) {
      return
    }
    putResponses(batch)
      .then(() => {
        report(null)
      })
      .catch((err: unknown) => {
        report(`${describe(err)} — this answer is not saved yet.`)
      })
  }, [report])

  const queue = useCallback(
    (id: string, entry: ResponseEntry) => {
      pending.current[id] = entry
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
      timer.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [flush],
  )

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    pending.current = {}
  }, [])

  useEffect(() => cancel, [cancel])

  return { queue, cancel }
}

function useEditor(queue: (id: string, entry: ResponseEntry) => void): Editor {
  const [responses, setResponses] = useState<Responses>({})
  // Mirrors `responses` so the callbacks below can read the current map without a state
  // updater doing the reading: updaters run twice under StrictMode, and these have to queue
  // a network write as well as compute the next value.
  const latest = useRef<Responses>({})

  const seed = useCallback((initial: Responses) => {
    latest.current = initial
    setResponses(initial)
  }, [])

  const apply = useCallback(
    (id: string, next: (prev: ResponseEntry) => ResponseEntry) => {
      const entry = next(latest.current[id] ?? NEW_ENTRY)
      latest.current = { ...latest.current, [id]: entry }
      setResponses(latest.current)
      queue(id, entry)
    },
    [queue],
  )

  const setValue = useCallback(
    (id: string, value: AnswerValue) => {
      apply(id, (prev) => ({ value, flagged: prev.flagged }))
    },
    [apply],
  )

  const toggleFlag = useCallback(
    (id: string) => {
      apply(id, (prev) => ({ value: prev.value, flagged: !prev.flagged }))
    },
    [apply],
  )

  return { responses, latest, seed, setValue, toggleFlag }
}

// Re-entrancy is the caller's to prevent, and `Quiz` prevents it by disabling the button
// for the whole 'submitting' status -- a second POST would come back 409, since the server
// closes the attempt on the first one. A guard here as well was tried and removed: with the
// button disabled nothing could reach it, so it was untestable code claiming to be a
// safeguard. The test that clicks Done twice pins the behaviour either way.
function useSubmit({ latest, cancel, setStatus, setError }: SubmitDeps): () => void {
  return useCallback(() => {
    cancel()
    setStatus('submitting')
    setError(null)
    // Sends the whole map rather than whatever autosave still had queued: this is the copy
    // that gets graded, so it must not depend on which debounce windows happened to land.
    putResponses(latest.current)
      .then(postSubmit)
      .then(() => {
        setStatus('submitted')
      })
      .catch((err: unknown) => {
        setStatus('ready')
        setError(`${describe(err)} — your answers were not sent.`)
      })
  }, [cancel, latest, setError, setStatus])
}

export interface QuizState {
  status: Status
  meta: Meta | null
  questions: PublicQuestion[]
  responses: Responses
  error: string | null
  setValue: (id: string, value: AnswerValue) => void
  toggleFlag: (id: string) => void
  submit: () => void
}

export function useQuiz(): QuizState {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<QuizData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { queue, cancel } = useAutosave(setError)
  const { responses, latest, seed, setValue, toggleFlag } = useEditor(queue)
  const submit = useSubmit({ latest, cancel, setStatus, setError })

  const onLoad = useCallback(
    (loaded: Loaded) => {
      seed(loaded.responses)
      setData({ meta: loaded.meta, questions: loaded.questions })
      if (loaded.submitted) {
        setStatus('submitted')
        return
      }
      setStatus('ready')
    },
    [seed],
  )

  const onFail = useCallback((message: string) => {
    setError(message)
    setStatus('failed')
  }, [])

  useLoad(onLoad, onFail)

  return {
    status,
    meta: data?.meta ?? null,
    questions: data?.questions ?? [],
    responses,
    error,
    setValue,
    toggleFlag,
    submit,
  }
}
