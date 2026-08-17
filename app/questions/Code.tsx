import type { ReactElement } from 'react'
import type { Props } from './types.ts'

const NOT_IMPLEMENTED = 'code renderer not implemented yet'

// Placeholder: the real renderer lands in a later task. It already takes the narrowed
// props, so replacing the body cannot change the contract.
export function Code(_props: Props<'code'>): ReactElement {
  return <p>{NOT_IMPLEMENTED}</p>
}
