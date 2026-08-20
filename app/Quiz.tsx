import { type ReactElement, useCallback, useState } from 'react'
import type { AnswerValue, PublicQuestion, ResponseEntry } from '../lib/types.ts'
import { summarize } from './lib/progress.ts'
import { QuestionView } from './questions/QuestionView.tsx'
import { useQuiz } from './useQuiz.ts'

const SENT_TITLE = 'Answers sent back to Claude'
const SENT_BODY = 'You can close this tab — the coaching continues in your session.'
const FAILED_TITLE = 'Could not open this quiz'
const OPENING = 'Opening the quiz…'
const KEEP_WORKING = 'Keep working'
const FLAG_ON = '⚑ not sure'
const FLAG_OFF = '⚐ not sure'
const DONE = 'Done'
const SEND_ANYWAY = 'Send anyway'
const SENDING = 'Sending…'

interface CardProps {
  question: PublicQuestion
  index: number
  total: number
  entry: ResponseEntry | undefined
  onValue: (id: string, value: AnswerValue) => void
  onFlag: (id: string) => void
}

interface FooterProps {
  answered: number
  total: number
  flagged: number
  confirming: boolean
  sending: boolean
  error: string | null
  onDone: () => void
  onCancel: () => void
}

function flagLabel(flagged: boolean): string {
  if (flagged) {
    return FLAG_ON
  }
  return FLAG_OFF
}

function progressLabel(answered: number, total: number, flagged: number): string {
  const counted = `${answered}/${total} answered`
  if (flagged > 0) {
    return `${counted} · ${flagged} flagged`
  }
  return counted
}

function doneLabel(confirming: boolean, sending: boolean): string {
  if (sending) {
    return SENDING
  }
  if (confirming) {
    return SEND_ANYWAY
  }
  return DONE
}

// A fill-in-the-blank question renders its own prompt, because the text and the inputs are
// interleaved; printing it here as well would show the raw {{id}} template above the card.
function Prompt({ question }: { question: PublicQuestion }): ReactElement | null {
  if (question.type === 'blank') {
    return null
  }
  return <p className="q-prompt">{question.prompt}</p>
}

function Alert({ message }: { message: string | null }): ReactElement | null {
  if (message === null) {
    return null
  }
  return (
    <span className="error" role="alert">
      {message}
    </span>
  )
}

// Rendered by count rather than by a boolean so the caller has one thing to get right: zero
// unanswered questions means there is nothing to confirm, whether or not Done was pressed.
function Confirmation({
  unanswered,
  onCancel,
}: {
  unanswered: number
  onCancel: () => void
}): ReactElement | null {
  if (unanswered === 0) {
    return null
  }
  return (
    <>
      <span className="warn">{`${unanswered} unanswered. Send anyway?`}</span>
      <button className="cancel" onClick={onCancel} type="button">
        {KEEP_WORKING}
      </button>
    </>
  )
}

function Card({ question, index, total, entry, onValue, onFlag }: CardProps): ReactElement {
  const handleValue = useCallback(
    (value: AnswerValue) => {
      onValue(question.id, value)
    },
    [onValue, question.id],
  )
  const handleFlag = useCallback(() => {
    onFlag(question.id)
  }, [onFlag, question.id])
  const flagged = entry?.flagged === true

  return (
    <section className="q">
      <div className="q-head">
        <span className="q-num">{`${index + 1} / ${total}`}</span>
        <button aria-pressed={flagged} className="q-flag" onClick={handleFlag} type="button">
          {flagLabel(flagged)}
        </button>
      </div>
      <Prompt question={question} />
      <QuestionView onChange={handleValue} question={question} value={entry?.value ?? null} />
    </section>
  )
}

function Footer(props: FooterProps): ReactElement {
  const { answered, total, flagged, confirming, sending, error, onDone, onCancel } = props
  let pending = 0
  if (confirming) {
    pending = total - answered
  }

  return (
    <footer>
      <span className="progress">{progressLabel(answered, total, flagged)}</span>
      <Alert message={error} />
      <Confirmation onCancel={onCancel} unanswered={pending} />
      <button className="done" disabled={sending} onClick={onDone} type="button">
        {doneLabel(confirming, sending)}
      </button>
    </footer>
  )
}

export function Quiz(): ReactElement {
  const { status, meta, questions, responses, error, setValue, toggleFlag, submit } = useQuiz()
  const [confirming, setConfirming] = useState(false)
  const { answered, total, flagged } = summarize(questions, responses)

  const handleDone = useCallback(() => {
    if (answered < total && !confirming) {
      setConfirming(true)
      return
    }
    submit()
  }, [answered, confirming, submit, total])

  const handleCancel = useCallback(() => {
    setConfirming(false)
  }, [])

  if (status === 'submitted') {
    return (
      <div className="done-msg">
        <h1>{SENT_TITLE}</h1>
        <p>{SENT_BODY}</p>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="done-msg" role="alert">
        <h1>{FAILED_TITLE}</h1>
        <p>{error}</p>
      </div>
    )
  }
  if (meta === null) {
    return <p className="done-msg">{OPENING}</p>
  }

  return (
    <>
      <header>
        <h1>{meta.title}</h1>
        <p>{meta.topic}</p>
      </header>
      <main>
        {questions.map((question, index) => (
          <Card
            entry={responses[question.id]}
            index={index}
            key={question.id}
            onFlag={toggleFlag}
            onValue={setValue}
            question={question}
            total={questions.length}
          />
        ))}
      </main>
      <Footer
        answered={answered}
        confirming={confirming}
        error={error}
        flagged={flagged}
        onCancel={handleCancel}
        onDone={handleDone}
        sending={status === 'submitting'}
        total={total}
      />
    </>
  )
}
