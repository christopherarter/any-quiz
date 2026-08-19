import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useRef,
} from 'react'
import type { Props } from './types.ts'

const INDENT = '  '
const TAB = 'Tab'

export function Code({ question, value, onChange }: Props<'code'>): ReactElement {
  const current = value ?? ''
  const area = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)

  // The textarea is controlled, so the re-render that carries the new text also rewrites
  // `value` and parks the caret at the end. Anyone indenting mid-line would find their next
  // keystroke at the bottom of the file, so the caret is put back once the DOM has the text.
  useEffect(() => {
    const at = caret.current
    if (at === null) {
      return
    }
    caret.current = null
    area.current?.setSelectionRange(at, at)
  })

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value)
    },
    [onChange],
  )

  // Tab indents; Shift+Tab is deliberately left alone, because with Tab captured it is the
  // only way to get out of the editor with a keyboard.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== TAB || event.shiftKey) {
        return
      }
      event.preventDefault()
      const { selectionStart, selectionEnd } = event.currentTarget
      caret.current = selectionStart + INDENT.length
      onChange(`${current.slice(0, selectionStart)}${INDENT}${current.slice(selectionEnd)}`)
    },
    [current, onChange],
  )

  return (
    <div>
      <span className="q-type">{question.language}</span>
      <textarea
        aria-label={question.prompt}
        className="code"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={`// ${question.language}`}
        ref={area}
        spellCheck={false}
        value={current}
      />
    </div>
  )
}
