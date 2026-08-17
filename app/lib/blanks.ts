export type Segment = { kind: 'text'; value: string } | { kind: 'blank'; id: string }

// Capturing group on purpose: `String.prototype.split` interleaves the captures into its
// result, so the whole prompt partitions in one pass -- even indices are literal text,
// odd indices are blank ids. Walking `matchAll` with an index cursor would mean reading
// `match[1]`, which `noUncheckedIndexedAccess` types as possibly-undefined and forces
// either a cast or a branch that can never run.
const BLANK_RE = /\{\{(\w+)\}\}/

export function parseBlanks(prompt: string): Segment[] {
  const segments: Segment[] = []
  for (const [index, part] of prompt.split(BLANK_RE).entries()) {
    if (index % 2 === 1) {
      segments.push({ kind: 'blank', id: part })
      // An empty text run appears whenever a blank starts or ends the prompt, or two sit
      // adjacent. Emitting it would render as a stray empty node between two inputs.
    } else if (part !== '') {
      segments.push({ kind: 'text', value: part })
    }
  }
  return segments
}
