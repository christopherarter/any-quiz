import type { ReactElement } from 'react'
import type { Props } from './types.ts'

const NOT_IMPLEMENTED = 'blank renderer not implemented yet'

// Placeholder: the real renderer lands in a later task. It already takes the narrowed
// props, so replacing the body cannot change the contract.
export function Blank(_props: Props<'blank'>): ReactElement {
  return <p>{NOT_IMPLEMENTED}</p>
}
