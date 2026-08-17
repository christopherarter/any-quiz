// biome-ignore lint/correctness/noUnresolvedImports: biome's exports-map resolver matches react's "react-server" condition key before "default" and resolves to a module that has no StrictMode export; the runtime and @types/react both provide it under the "default" condition Node actually picks
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './style.css'

const PLACEHOLDER_TEXT = 'placeholder — replaced by a later task'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('#root missing from index.html')
}

createRoot(root).render(
  <StrictMode>
    <p>{PLACEHOLDER_TEXT}</p>
  </StrictMode>,
)
