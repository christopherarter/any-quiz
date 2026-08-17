import type { ReactElement } from 'react'
import type { Props } from './types.ts'

const NOT_IMPLEMENTED = 'match renderer not implemented yet'

// Placeholder: the real renderer lands in a later task. It already takes the narrowed
// props, so replacing the body cannot change the contract.
export function Match(_props: Props<'match'>): ReactElement {
  return <p>{NOT_IMPLEMENTED}</p>
}
