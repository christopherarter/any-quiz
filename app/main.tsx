// biome-ignore lint/correctness/noUnresolvedImports: biome's exports-map resolver matches react's "react-server" condition key before "default" and resolves to a module that has no StrictMode export; the runtime and @types/react both provide it under the "default" condition Node actually picks
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Quiz } from './Quiz.tsx'
import './style.css'

const root = document.getElementById('root')
if (root === null) {
  throw new Error('#root missing from index.html')
}

createRoot(root).render(
  <StrictMode>
    <Quiz />
  </StrictMode>,
)
