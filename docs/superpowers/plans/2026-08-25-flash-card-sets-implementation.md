# Flash Card Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `kind: 'set'` variant of a quiz folder — a flash card set — that restricts questions to the four self-scoring types, reshuffles order and reports a score on every run within one server invocation, and hands Claude a whole-sitting wrap-up (`history.json`) when the user is done.

**Architecture:** One `kind` discriminator (`'quiz' | 'set'`, absent meaning `'quiz'`) threads through the existing pipeline — `meta.json` → `validateQuestions` → `QuizContext` → the submit route → the frontend — so a set reuses every quiz code path and only branches where behavior actually differs: validation (reject `short`/`code`), submit (score + append history + reset instead of terminating), a new `/api/finish` route, and the frontend footer. `readAnswers`/`skeleton()` take `kind` as a **required** parameter (no default) — an earlier draft of the design defaulted it and that silently dropped the shuffle on a set's first run before any submit had happened; requiring it forces every call site to be looked at once, the same way this codebase already uses exhaustive switches with no `default` case to turn a missed spot into a compile error instead of a silent bug.

**Tech Stack:** TypeScript (Node ≥22.18, native type stripping), Hono, Zod, React 19, Vitest (two projects: `node` and `jsdom`), Biome (`preset: "all"`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-21-flash-card-sets-design.md` (as revised 2026-08-25 against the current codebase). Builds on `docs/superpowers/specs/2026-08-17-any-quiz-design.md`.

## Global Constraints

- `short` / `code` question types are rejected in a `kind: 'set'` folder — enforced only by `validateQuestions`, never by the UI.
- `validateQuestions(doc, kind = 'quiz')` keeps a default — every existing one-argument call site must keep compiling untouched.
- `readAnswers(dir, quizId, questionIds, kind)` and `skeleton(quizId, questionIds, kind)` take `kind` as a **required** fourth/third parameter — no default. Every call site must pass it explicitly.
- `meta.json`'s `kind` field is written only when it is `'set'` — never a written `"quiz"`. A quiz's `meta.json` is byte-for-byte what it was before this feature (success criterion 4 in the spec).
- `answers.json`'s `order` field exists only for a set; never write it for a quiz.
- Every write to `history.json` is atomic: write `<path>.tmp`, then `renameSync` — matching `writeAnswers`'s existing pattern.
- No new runtime dependencies. Node ≥22.18 only.
- `biome check .` (preset `all`) and `tsc --noEmit` must pass after every task. This repo's pre-write hook runs `biome check` on every edit. Follow the file's existing conventions for named constants — this codebase already writes bare `2` for a JSON indent and bare `1` for a `version: 1` literal without a named constant or `biome-ignore`, so new code in the same files matches that, not a stricter standard invented for this feature.
- Every declaration below the last export in a modified `lib/*.ts` or `serve.ts` file must itself be exported (`useExportsLast`) — when a previously-private function becomes exported, move it to sit among the file's other exports rather than leaving a private declaration after it.
- `npm run build` must be re-run and its output (`app/dist/`, `bin/any-quiz.mjs`, both `.buildinfo.json` files) committed before the feature is done — `test/buildinfo.test.ts` / `test/bin-bundle.test.ts` fail on a stale bundle.
- All three harness adapters (`skills/any-quiz/SKILL.md`, `pi-skills/any-quiz/SKILL.md`, `codex-skills/any-quiz/SKILL.md`) get identical documentation content, differing only in each file's own existing invocation-prefix / background-vs-blocking convention.

---

### Task 1: Types — `QuizKind`, `Meta.kind`, `Answers.order`, history & finish payload types

**Files:**
- Modify: `lib/types.ts`
- Test: `test/types.test.ts`

**Interfaces:**
- Produces: `export type QuizKind = 'quiz' | 'set'`
- Produces: `Meta.kind?: QuizKind`
- Produces: `Answers.order?: string[]`
- Produces: `export interface HistoryEntry { ranAt: string; correct: number; total: number; perQuestion: Record<string, boolean>; flagged: string[] }`
- Produces: `export interface HistoryDoc { version: 1; runs: HistoryEntry[] }`
- Produces: `export interface FinishPayload { quizId: string; quizDir: string; kind: 'set'; runs: HistoryEntry[] }`

- [ ] **Step 1: Write the failing test**

Add to `test/types.test.ts`'s import line (currently `import type { PublicQuestion, Question, QuestionType } from '../lib/types.ts'`):

```ts
import type {
  Answers,
  FinishPayload,
  HistoryEntry,
  Meta,
  PublicQuestion,
  Question,
  QuestionType,
  QuizKind,
} from '../lib/types.ts'
```

Append:

```ts
test('QuizKind is quiz or set, and Meta/Answers carry the new optional fields', () => {
  expectTypeOf<QuizKind>().toEqualTypeOf<'quiz' | 'set'>()
  expectTypeOf<Meta['kind']>().toEqualTypeOf<QuizKind | undefined>()
  expectTypeOf<Answers['order']>().toEqualTypeOf<string[] | undefined>()
})

test('FinishPayload carries a fixed kind of "set" and the full run history', () => {
  expectTypeOf<FinishPayload['kind']>().toEqualTypeOf<'set'>()
  expectTypeOf<FinishPayload['runs']>().toEqualTypeOf<HistoryEntry[]>()
})
```

- [ ] **Step 2: Run the tests, confirm they fail on the missing exports**

Run: `npx vitest run test/types.test.ts`
Expected: fails to resolve `QuizKind` / `FinishPayload` / `HistoryEntry` from `../lib/types.ts` — a module-resolution/type error, not an assertion failure.

- [ ] **Step 3: Implement in `lib/types.ts`**

Insert after `export interface ResponseEntry { ... }` and before `export interface Answers { ... }`:

```ts
// 'quiz' is what every folder was before this field existed, so it is also what an
// absent field means -- every caller normalizes with `meta.kind ?? 'quiz'` rather than
// this type carrying `undefined` itself.
export type QuizKind = 'quiz' | 'set'
```

Change `Answers` to:

```ts
export interface Answers {
  quizId: string
  status: 'draft' | 'submitted'
  startedAt: string
  updatedAt: string
  submittedAt: string | null
  responses: Record<string, ResponseEntry>
  // Set-only: the current run's question order. Never present for a quiz.
  order?: string[]
}
```

Change `Meta` to:

```ts
export interface Meta {
  id: string
  slug: string
  title: string
  topic: string
  createdAt: string
  parentQuizId: string | null
  targets: string[]
  // Absent means 'quiz'. Never written as the literal "quiz" -- see QuizKind.
  kind?: QuizKind
}
```

Append after `ResultPayload`:

```ts
export interface HistoryEntry {
  ranAt: string
  correct: number
  total: number
  perQuestion: Record<string, boolean>
  flagged: string[]
}

export interface HistoryDoc {
  version: 1
  runs: HistoryEntry[]
}

// The `POST /api/finish` / `'finished'` event payload -- distinct from ResultPayload,
// which is one scored quiz attempt, not a whole sitting's worth of set runs.
export interface FinishPayload {
  quizId: string
  quizDir: string
  kind: 'set'
  runs: HistoryEntry[]
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/types.test.ts && npx tsc --noEmit`
Expected: all pass; `tsc` clean (these are all-new, all-optional additions — nothing else in the repo references them yet).

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts test/types.test.ts
git commit -m "feat: add QuizKind, Meta.kind, Answers.order, and the history/finish payload types"
```

---

### Task 2: `validateQuestions` rejects `short`/`code` for a set; `loadFull` passes `kind` through

**Files:**
- Modify: `lib/question-schema.ts`
- Modify: `lib/quiz.ts:57-65` (`loadFull`)
- Test: `test/quiz.test.ts`

**Interfaces:**
- Consumes: `QuizKind` (Task 1)
- Produces: `validateQuestions(doc: unknown, kind?: QuizKind): string[]` — `kind` defaults to `'quiz'`

- [ ] **Step 1: Write the failing tests**

Add `const NOT_ALLOWED_IN_SET_RE = /not allowed in a flash card set/` to `test/quiz.test.ts`'s regex-constant block (near the other `_RE` constants).

Append:

```ts
test('kind defaults to quiz, so short and code remain valid with no second argument', () => {
  expect(validateQuestions(fixture())).toEqual([])
})

test('set-kind rejects short and code questions', () => {
  expect(validateQuestions(fixture(), 'set').join('\n')).toMatch(NOT_ALLOWED_IN_SET_RE)
})

test('set-kind accepts the four closed types with short/code removed', () => {
  const doc = fixture()
  // biome-ignore lint/suspicious/noExplicitAny: fixture() is untyped by design; see its own comment
  doc.questions = doc.questions.filter((q: any) => q.type !== 'short' && q.type !== 'code')
  expect(validateQuestions(doc, 'set')).toEqual([])
})

test('loadFull rejects short/code questions when meta.kind is "set"', () => {
  const dir = tmp()
  const meta = JSON.parse(readFileSync(join(FIXTURE_DIR, 'meta.json'), 'utf8'))
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ ...meta, kind: 'set' }))
  writeFileSync(join(dir, 'questions.json'), JSON.stringify(fixture()))
  expect(() => loadFull(dir)).toThrow(QuizError)
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run test/quiz.test.ts`
Expected: the first test passes already (no behavior change yet for the 1-arg call); the `'set'`-kind tests fail because `validateQuestions` ignores a second argument today, so `short`/`code` still validate as allowed; the `loadFull` test fails because `loadFull` never rejects anything based on `meta.kind` yet.

- [ ] **Step 3: Implement in `lib/question-schema.ts`**

Change the type import:

```ts
import type { QuestionType, QuizKind } from './types.ts'
```

Add near `TYPES`:

```ts
const SET_DISALLOWED_TYPES: ReadonlySet<QuestionType> = new Set<QuestionType>(['short', 'code'])
```

Change `validateQuestion`'s signature and insert the new check right after the type check (before the `q.answer === undefined` check, so a set-disallowed type is reported once and does not also get a possibly-confusing "missing answer" or per-type-schema error for a type it isn't allowed to have at all):

```ts
function validateQuestion(
  raw: unknown,
  index: number,
  seen: Set<string>,
  out: string[],
  kind: QuizKind,
): void {
  const q = (raw ?? {}) as Loose

  const idResult = IdSchema.safeParse(q.id)
  if (!idResult.success) {
    out.push(`question #${index + 1}: ${firstIssue(idResult)}`)
    return
  }
  const { data: id } = idResult
  if (seen.has(id)) {
    out.push(`${id}: duplicate id`)
  }
  seen.add(id)

  const promptResult = PromptSchema.safeParse(q.prompt)
  if (!promptResult.success) {
    out.push(`${id}: ${firstIssue(promptResult)}`)
    return
  }

  const typeResult = TypeSchema.safeParse(q.type)
  if (!typeResult.success) {
    out.push(`${id}: ${firstIssue(typeResult)}`)
    return
  }

  if (kind === 'set' && SET_DISALLOWED_TYPES.has(typeResult.data)) {
    out.push(`${id}: type "${typeResult.data}" is not allowed in a flash card set`)
    return
  }

  if (q.answer === undefined) {
    out.push(`${id}: missing answer`)
    return
  }

  const result = QUESTION_SCHEMAS[typeResult.data].safeParse(q)
  if (!result.success) {
    for (const issue of result.error.issues) {
      out.push(`${id}: ${issue.message}`)
    }
  }
}
```

Change `validateQuestions`:

```ts
function validateQuestions(doc: unknown, kind: QuizKind = 'quiz'): string[] {
  const rootResult = RootSchema.safeParse(doc)
  if (!rootResult.success) {
    return ['questions.json must be a JSON object']
  }
  const { version, questions } = rootResult.data
  const out: string[] = []

  const versionResult = z
    .literal(1, {
      error: (issue) => `unsupported version ${JSON.stringify(issue.input)}, expected 1`,
    })
    .safeParse(version)
  if (!versionResult.success) {
    out.push(firstIssue(versionResult))
  }

  const questionsMessage = 'questions must be an array with at least one entry'
  const questionsResult = z
    .array(z.unknown(), { error: () => questionsMessage })
    .min(1, questionsMessage)
    .safeParse(questions)
  if (!questionsResult.success) {
    out.push(firstIssue(questionsResult))
    return out
  }

  const seen = new Set<string>()
  for (const [i, entry] of questionsResult.data.entries()) {
    validateQuestion(entry, i, seen, out, kind)
  }
  return out
}
```

- [ ] **Step 4: Implement in `lib/quiz.ts`**

Change `loadFull` (currently `const errors = validateQuestions(doc)`):

```ts
export function loadFull(dir: string): { meta: Meta; questions: Question[] } {
  const meta = readJson(join(dir, 'meta.json'), 'meta.json') as Meta
  const doc = readJson(join(dir, 'questions.json'), 'questions.json')
  const errors = validateQuestions(doc, meta.kind ?? 'quiz')
  if (errors.length > 0) {
    throw new QuizError('questions.json failed validation', errors)
  }
  return { meta, questions: (doc as QuestionsDoc).questions }
}
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `npx vitest run test/quiz.test.ts && npx tsc --noEmit`
Expected: all pass, including every pre-existing test in the file (a bare `validateQuestions(doc)` call still defaults to `'quiz'` and behaves exactly as before).

- [ ] **Step 6: Commit**

```bash
git add lib/question-schema.ts lib/quiz.ts test/quiz.test.ts
git commit -m "feat: reject short/code questions in a flash card set"
```

---

### Task 3: `skeleton()`/`readAnswers` become kind-aware — the reshuffle fix

**Files:**
- Modify: `lib/quiz.ts:1-99` (type import, the `skeleton`/`readJson` block, `readAnswers`)
- Modify: `lib/server.ts:9,57,76,94` (three call sites — inline `ctx.meta.kind ?? 'quiz'` for now; `QuizContext.kind` itself arrives in Task 7)
- Modify: `serve.ts:82` (one call site — inline `loaded.meta.kind ?? 'quiz'`)
- Test: `test/quiz.test.ts`

**Interfaces:**
- Consumes: `QuizKind` (Task 1)
- Produces: `export function skeleton(quizId: string, questionIds: string[], kind: QuizKind): Answers` (was private, unexported, and 2-argument)
- Produces: `export function readAnswers(dir: string, quizId: string, questionIds: string[], kind: QuizKind): Answers` (`kind` is a new **required** fourth parameter)

This is the fix for the gap the spec calls out: `skeleton()`'s shuffle is only reachable through `readAnswers` when `answers.json` doesn't exist yet, so `kind` has to be threaded one level further than "just add a parameter to `skeleton`." Making it required (not defaulted) means every place that builds or reads a fresh draft has to be looked at now, instead of silently defaulting to `'quiz'` behavior (no shuffle) the way an easy-to-miss optional parameter would.

- [ ] **Step 1: Write the failing tests**

Append to `test/quiz.test.ts`:

```ts
test('readAnswers with kind "quiz" builds a skeleton with no order', () => {
  const a = readAnswers(tmp(), 'a3f9', ['q1', 'q2'], 'quiz')
  expect(a.order).toBeUndefined()
})

test('readAnswers with kind "set" builds a skeleton whose order is a shuffle of every question id', () => {
  const a = readAnswers(tmp(), 'a3f9', ['q1', 'q2', 'q3'], 'set')
  expect(a.order).toBeDefined()
  expect([...(a.order ?? [])].sort()).toEqual(['q1', 'q2', 'q3'])
})
```

- [ ] **Step 2: Update the type import in `lib/quiz.ts`**

```ts
import type {
  Answers,
  Meta,
  PublicQuestion,
  Question,
  QuestionsDoc,
  QuizKind,
  ResponseEntry,
} from './types.ts'
```

- [ ] **Step 3: Reorder and rewrite the `skeleton`/`readJson` block in `lib/quiz.ts`**

Replace (the current `skeleton` function followed immediately by `readJson`):

```ts
function skeleton(quizId: string, questionIds: string[]): Answers {
  const now = new Date().toISOString()
  const responses: Record<string, ResponseEntry> = {}
  for (const id of questionIds) {
    responses[id] = { value: null, flagged: false }
  }
  return { quizId, status: 'draft', startedAt: now, updatedAt: now, submittedAt: null, responses }
}

function readJson(path: string, label: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    const error = new QuizError(`cannot read ${label} at ${path}`, [(err as Error).message])
    error.cause = err
    throw error
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    const error = new QuizError(`${label} is not valid JSON`, [(err as Error).message])
    error.cause = err
    throw error
  }
}
```

with (`readJson` first, then `skeleton` — now exported — last, so no private declaration follows an exported one, per `useExportsLast`):

```ts
function readJson(path: string, label: string): unknown {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    const error = new QuizError(`cannot read ${label} at ${path}`, [(err as Error).message])
    error.cause = err
    throw error
  }
  try {
    return JSON.parse(raw)
  } catch (err) {
    const error = new QuizError(`${label} is not valid JSON`, [(err as Error).message])
    error.cause = err
    throw error
  }
}

// Fisher-Yates. `order[i]`/`order[j]` are always in bounds by the loop's own invariant,
// but noUncheckedIndexedAccess types them as possibly undefined regardless -- the guard
// satisfies tsc without a cast.
function shuffledOrder(questionIds: string[]): string[] {
  const order = [...questionIds]
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = order[i]
    const b = order[j]
    if (a === undefined || b === undefined) {
      continue
    }
    order[i] = b
    order[j] = a
  }
  return order
}

export function skeleton(quizId: string, questionIds: string[], kind: QuizKind): Answers {
  const now = new Date().toISOString()
  const responses: Record<string, ResponseEntry> = {}
  for (const id of questionIds) {
    responses[id] = { value: null, flagged: false }
  }
  const base: Answers = {
    quizId,
    status: 'draft',
    startedAt: now,
    updatedAt: now,
    submittedAt: null,
    responses,
  }
  if (kind === 'set') {
    return { ...base, order: shuffledOrder(questionIds) }
  }
  return base
}
```

- [ ] **Step 4: Update `readAnswers` in `lib/quiz.ts`**

```ts
export function readAnswers(
  dir: string,
  quizId: string,
  questionIds: string[],
  kind: QuizKind,
): Answers {
  const path = answersPath(dir)
  if (!existsSync(path)) {
    return skeleton(quizId, questionIds, kind)
  }
  const saved = readJson(path, 'answers.json') as Answers
  saved.responses ??= {}
  for (const id of questionIds) {
    saved.responses[id] ??= { value: null, flagged: false }
  }
  return saved
}
```

- [ ] **Step 5: Find every now-broken call site**

Run: `npx tsc --noEmit`
Expected: "Expected 3 arguments, but got 2" (or similar) at every pre-existing call — nine in `test/quiz.test.ts`, three in `lib/server.ts`, one in `serve.ts`. Confirm the count matches before moving on:

```bash
grep -rn "readAnswers(" --include="*.ts" . | grep -v node_modules | grep -v "^./lib/quiz.ts"
```

- [ ] **Step 6: Fix `test/quiz.test.ts`'s nine call sites**

Three distinct find-and-replace operations cover all nine (several lines share identical text):

1. Replace **all** occurrences of `readAnswers(dir, 'a3f9', ['q1'])` with `readAnswers(dir, 'a3f9', ['q1'], 'quiz')` (six occurrences: the round-trip test, the `updatedAt`-stamp test, the backfill test, the archive test, and the corrupt-file test).
2. Replace the one occurrence of `readAnswers(dir, 'a3f9', ['q1', 'q2'])` with `readAnswers(dir, 'a3f9', ['q1', 'q2'], 'quiz')` (the backfill test's second call).
3. Replace the one occurrence of `readAnswers(tmp(), 'a3f9', ['q1', 'q2'])` with `readAnswers(tmp(), 'a3f9', ['q1', 'q2'], 'quiz')` (the "returns a skeleton" test).

- [ ] **Step 7: Fix `lib/server.ts`'s three call sites**

Replace the GET handler line:

```ts
app.get('/api/answers', (c) => c.json(readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds), OK))
```

with:

```ts
app.get('/api/answers', (c) => c.json(readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.meta.kind ?? 'quiz'), OK))
```

Replace **both** occurrences of the identical line `const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds)` (one inside the `PUT /api/answers` handler, one inside `POST /api/submit`) with:

```ts
const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.meta.kind ?? 'quiz')
```

(`ctx.kind` doesn't exist yet — Task 7 adds it and simplifies these three lines to `ctx.kind`.)

- [ ] **Step 8: Fix `serve.ts`'s one call site**

Replace:

```ts
if (readAnswers(dir, loaded.meta.id, ids).status !== 'submitted') {
```

with:

```ts
if (readAnswers(dir, loaded.meta.id, ids, loaded.meta.kind ?? 'quiz').status !== 'submitted') {
```

- [ ] **Step 9: Run the tests, confirm everything passes**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no compile errors anywhere in the repo; every test file passes, including the two new tests from Step 1 and every pre-existing test in `test/quiz.test.ts`, `test/server.test.ts`, `test/server-submit.test.ts`, and `test/cli.test.ts`.

- [ ] **Step 10: Commit**

```bash
git add lib/quiz.ts lib/server.ts serve.ts test/quiz.test.ts
git commit -m "fix: thread kind through skeleton/readAnswers so a set's first run shuffles too"
```

---

### Task 4: `history.json` read/write/append and the finish-payload builder

**Files:**
- Modify: `lib/quiz.ts` (add `historyPath`, `readHistory`, `appendHistoryEntry`, `buildFinishPayload`, placed after `archiveAnswers` and before `ScaffoldInput`)
- Test: `test/quiz.test.ts`

**Interfaces:**
- Consumes: `HistoryEntry`, `HistoryDoc`, `FinishPayload`, `Meta` (Task 1)
- Produces: `export function historyPath(dir: string): string`
- Produces: `export function readHistory(dir: string): HistoryDoc`
- Produces: `export function appendHistoryEntry(dir: string, entry: HistoryEntry): void`
- Produces: `export function buildFinishPayload(meta: Meta, dir: string, runs: HistoryEntry[]): FinishPayload`

- [ ] **Step 1: Write the failing tests**

Add `HistoryEntry`, `Meta` to a new type-only import in `test/quiz.test.ts` (`import type { HistoryEntry, Meta } from '../lib/types.ts'`), and add `appendHistoryEntry, buildFinishPayload, historyPath, readHistory` to the existing value import from `'../lib/quiz.ts'`.

Append:

```ts
test('historyPath points at history.json inside the quiz dir', () => {
  const dir = tmp()
  expect(historyPath(dir)).toBe(join(dir, 'history.json'))
})

test('readHistory returns an empty run list when no file exists yet', () => {
  expect(readHistory(tmp())).toEqual({ version: 1, runs: [] })
})

test('appendHistoryEntry persists an entry and readHistory reads it back', () => {
  const dir = tmp()
  const entry: HistoryEntry = {
    ranAt: '2026-08-25T14:05:02.000Z',
    correct: 3,
    total: 4,
    perQuestion: { q1: true, q2: false, q3: true, q4: true },
    flagged: ['q2'],
  }
  appendHistoryEntry(dir, entry)
  expect(readHistory(dir)).toEqual({ version: 1, runs: [entry] })
})

test('appendHistoryEntry appends to existing runs rather than overwriting them', () => {
  const dir = tmp()
  const first: HistoryEntry = { ranAt: 't1', correct: 1, total: 4, perQuestion: {}, flagged: [] }
  const second: HistoryEntry = { ranAt: 't2', correct: 2, total: 4, perQuestion: {}, flagged: [] }
  appendHistoryEntry(dir, first)
  appendHistoryEntry(dir, second)
  expect(readHistory(dir).runs).toEqual([first, second])
})

test('appendHistoryEntry throws QuizError on a corrupt history file', () => {
  const dir = tmp()
  writeFileSync(historyPath(dir), '{ not json')
  expect(() => appendHistoryEntry(dir, { ranAt: 't1', correct: 0, total: 0, perQuestion: {}, flagged: [] })).toThrow(QuizError)
})

test('buildFinishPayload assembles the finish event payload from meta, dir, and runs', () => {
  const meta: Meta = {
    id: 'b7c2',
    slug: 'heap-basics-set',
    title: 'Heap Basics',
    topic: 'Drill the basics',
    createdAt: '2026-08-25T00:00:00.000Z',
    parentQuizId: null,
    targets: [],
    kind: 'set',
  }
  const runs: HistoryEntry[] = [{ ranAt: 't1', correct: 1, total: 1, perQuestion: { q1: true }, flagged: [] }]
  expect(buildFinishPayload(meta, '/some/dir', runs)).toEqual({
    quizId: 'b7c2',
    quizDir: '/some/dir',
    kind: 'set',
    runs,
  })
})
```

- [ ] **Step 2: Run the tests, confirm they fail on the missing exports**

Run: `npx vitest run test/quiz.test.ts`
Expected: `TypeError: historyPath is not a function` (or similar) — not an assertion failure.

- [ ] **Step 3: Implement in `lib/quiz.ts`**

Add the type import: extend the existing `import type { ... } from './types.ts'` line to include `FinishPayload` and `HistoryDoc` and `HistoryEntry`.

Add, right after `archiveAnswers` and before `export interface ScaffoldInput`:

```ts
export function historyPath(dir: string): string {
  return join(dir, 'history.json')
}

export function readHistory(dir: string): HistoryDoc {
  const path = historyPath(dir)
  if (!existsSync(path)) {
    return { version: 1, runs: [] }
  }
  return readJson(path, 'history.json') as HistoryDoc
}

export function appendHistoryEntry(dir: string, entry: HistoryEntry): void {
  const history = readHistory(dir)
  history.runs.push(entry)
  const path = historyPath(dir)
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(history, null, 2)}\n`)
  renameSync(tmpPath, path)
}

export function buildFinishPayload(meta: Meta, dir: string, runs: HistoryEntry[]): FinishPayload {
  return { quizId: meta.id, quizDir: dir, kind: 'set', runs }
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/quiz.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts test/quiz.test.ts
git commit -m "feat: add history.json read/write/append and the finish-payload builder"
```

---

### Task 5: `scaffoldQuiz` writes `kind` into `meta.json` when requested

**Files:**
- Modify: `lib/quiz.ts` (`ScaffoldInput`, `scaffoldQuiz`)
- Test: `test/quiz.test.ts`

**Interfaces:**
- Consumes: `QuizKind` (Task 1)
- Produces: `ScaffoldInput.kind?: QuizKind`

- [ ] **Step 1: Write the failing tests**

Append to `test/quiz.test.ts`:

```ts
test('scaffoldQuiz writes kind "set" into meta.json when requested', () => {
  const { dir, meta } = scaffoldQuiz(tmp(), {
    slug: 'heap-basics-set',
    title: 'Heap Basics',
    topic: 'Drill the basics',
    kind: 'set',
  })
  expect(meta.kind).toBe('set')
  expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')).kind).toBe('set')
})

test('scaffoldQuiz omits kind entirely when not requested', () => {
  const { dir, meta } = scaffoldQuiz(tmp(), { slug: 'rust-lifetimes', title: 'T', topic: 'Top' })
  expect(meta).not.toHaveProperty('kind')
  expect(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))).not.toHaveProperty('kind')
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run test/quiz.test.ts`
Expected: the first new test fails (`meta.kind` is `undefined`, not `'set'`, and the on-disk file has no `kind` key); the second passes already (nothing to omit yet).

- [ ] **Step 3: Implement in `lib/quiz.ts`**

Change `ScaffoldInput`:

```ts
export interface ScaffoldInput {
  slug: string
  title: string
  topic: string
  parentQuizId?: string | null
  targets?: string[]
  kind?: QuizKind
}
```

Change the `meta` construction inside `scaffoldQuiz`:

```ts
  const meta: Meta = {
    id,
    slug: input.slug,
    title: input.title,
    topic: input.topic,
    createdAt,
    parentQuizId: input.parentQuizId ?? null,
    targets: input.targets ?? [],
    ...(input.kind === 'set' ? { kind: 'set' as const } : {}),
  }
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/quiz.test.ts`
Expected: all pass, including the three pre-existing `scaffoldQuiz` tests (the conditional spread means an omitted `kind` produces the exact same object shape as before — `toEqual` still matches byte-for-byte).

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts test/quiz.test.ts
git commit -m "feat: scaffoldQuiz writes kind into meta.json only when it is set"
```

---

### Task 6: `serve.ts scaffold --kind set` flag

**Files:**
- Modify: `serve.ts` (`SCAFFOLD_USAGE`, `ScaffoldArgs`, `parseScaffoldArgs`, `mainScaffold`)
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `scaffoldQuiz` with `ScaffoldInput.kind` (Task 5)
- Produces: `ScaffoldArgs.kind: string | null`
- Produces: `parseScaffoldArgs` reads `--kind <value>`

- [ ] **Step 1: Write the failing tests**

Change the import line in `test/cli.test.ts` from:

```ts
import { parseArgs } from '../serve.ts'
```

to:

```ts
import { parseArgs, parseScaffoldArgs } from '../serve.ts'
```

Append:

```ts
test('parseScaffoldArgs reads --kind alongside the existing flags', () => {
  expect(parseScaffoldArgs(['/base', 'slug', 'Title', 'Topic', '--kind', 'set'])).toEqual({
    baseDir: '/base',
    slug: 'slug',
    title: 'Title',
    topic: 'Topic',
    parent: null,
    targets: [],
    kind: 'set',
  })
})

test('scaffold --kind set writes {"kind":"set"} into meta.json', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))
  const s = start([
    'scaffold',
    baseDir,
    'heap-basics-set',
    'Heap Basics',
    'One sentence',
    '--kind',
    'set',
  ])
  expect(await s.exited).toBe(EXIT_OK)
  const result = JSON.parse(s.stdout())
  expect(result.meta.kind).toBe('set')
})

test('scaffold without --kind writes no kind field at all', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))
  const s = start(['scaffold', baseDir, 'rust-lifetimes', 'Rust Lifetimes', 'One sentence'])
  expect(await s.exited).toBe(EXIT_OK)
  const result = JSON.parse(s.stdout())
  expect(result.meta).not.toHaveProperty('kind')
})

test('scaffold rejects an unrecognized --kind value', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))
  const s = start([
    'scaffold',
    baseDir,
    'rust-lifetimes',
    'Rust Lifetimes',
    'One sentence',
    '--kind',
    'nope',
  ])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(/--kind/)
  expect(s.stdout()).toBe('')
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run test/cli.test.ts`
Expected: `parseScaffoldArgs` test fails (`kind` key is missing from the returned object, or the import itself fails — `parseScaffoldArgs` isn't exported/used from the test yet is fine, it already exists, so this is an assertion failure on the `kind` field specifically); the `--kind set` test fails because `result.meta.kind` is `undefined`; the "no kind field" test passes already; the "rejects unrecognized" test fails because today `--kind nope` is silently ignored (parsed as a stray positional-less flag) and the scaffold succeeds.

- [ ] **Step 3: Implement in `serve.ts`**

Change `SCAFFOLD_USAGE`:

```ts
const SCAFFOLD_USAGE =
  'usage: serve.ts scaffold <base-dir> <slug> <title> <topic> [--parent id] [--target id]... [--kind set]'
```

Change `ScaffoldArgs`:

```ts
export interface ScaffoldArgs {
  baseDir: string | null
  slug: string | null
  title: string | null
  topic: string | null
  parent: string | null
  targets: string[]
  kind: string | null
}
```

Change `parseScaffoldArgs`:

```ts
export function parseScaffoldArgs(argv: string[]): ScaffoldArgs {
  const out: ScaffoldArgs = {
    baseDir: null,
    slug: null,
    title: null,
    topic: null,
    parent: null,
    targets: [],
    kind: null,
  }
  const positionals: string[] = []
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    i += 1
    if (arg === '--parent') {
      out.parent = argv[i] ?? null
      i += 1
    } else if (arg === '--target') {
      const target = argv[i]
      if (target !== undefined) {
        out.targets.push(target)
      }
      i += 1
    } else if (arg === '--kind') {
      out.kind = argv[i] ?? null
      i += 1
    } else if (arg !== undefined) {
      positionals.push(arg)
    }
  }
  const [baseDir, slug, title, topic] = positionals
  out.baseDir = baseDir ?? null
  out.slug = slug ?? null
  out.title = title ?? null
  out.topic = topic ?? null
  return out
}
```

Change `mainScaffold`:

```ts
function mainScaffold(argv: string[]): void {
  const opts = parseScaffoldArgs(argv)
  if (opts.baseDir === null || opts.slug === null || opts.title === null || opts.topic === null) {
    fail(SCAFFOLD_USAGE)
  }
  if (opts.kind !== null && opts.kind !== 'quiz' && opts.kind !== 'set') {
    fail(`--kind must be "quiz" or "set", got "${opts.kind}"`)
  }
  const kind = opts.kind === 'set' ? 'set' : undefined

  let result: { dir: string; meta: Meta }
  try {
    result = scaffoldQuiz(opts.baseDir, {
      slug: opts.slug,
      title: opts.title,
      topic: opts.topic,
      parentQuizId: opts.parent,
      targets: opts.targets,
      kind,
    })
  } catch (err) {
    if (err instanceof QuizError) {
      fail(err.message, err.errors)
    }
    throw err
  }
  process.stdout.write(`${JSON.stringify(result, null, JSON_INDENT)}\n`)
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/cli.test.ts && npx tsc --noEmit`
Expected: all pass, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add serve.ts test/cli.test.ts
git commit -m "feat: add --kind set to the scaffold subcommand"
```

---

### Task 7: `QuizContext.kind`, a `set`-kind test fixture, and the answers-route refactor

**Files:**
- Create: `examples/set-example/meta.json`
- Create: `examples/set-example/questions.json`
- Modify: `lib/server.ts` (`QuizContext`, `createServer`, `registerAnswers`)
- Test: Create `test/server-set.test.ts`

**Interfaces:**
- Consumes: `QuizKind` (Task 1), the kind-aware `readAnswers` (Task 3)
- Produces: `QuizContext.kind: QuizKind`

- [ ] **Step 1: Create the fixture**

Create `examples/set-example/meta.json`:

```json
{
  "id": "b7c2",
  "slug": "heap-basics-set",
  "title": "Heap Basics — Flash Cards",
  "topic": "Binary heap properties, complexity, and terminology",
  "createdAt": "2026-08-25T00:00:00Z",
  "parentQuizId": null,
  "targets": [],
  "kind": "set"
}
```

Create `examples/set-example/questions.json` (the four closed types only — no `short`/`code`):

```json
{
  "version": 1,
  "questions": [
    {
      "id": "q1",
      "type": "mcq",
      "prompt": "What is the average-case time complexity of heapsort?",
      "choices": [
        { "id": "a", "text": "O(n)" },
        { "id": "b", "text": "O(n log n)" },
        { "id": "c", "text": "O(n^2)" }
      ],
      "answer": "b",
      "rationale": "Each of the n sift-down operations costs O(log n)."
    },
    {
      "id": "q2",
      "type": "multi",
      "prompt": "Which of these are stable sorting algorithms?",
      "choices": [
        { "id": "a", "text": "merge sort" },
        { "id": "b", "text": "heapsort" },
        { "id": "c", "text": "insertion sort" },
        { "id": "d", "text": "quicksort" }
      ],
      "answer": ["a", "c"],
      "rationale": "Merge and insertion sort preserve the relative order of equal keys; heapsort and quicksort do not."
    },
    {
      "id": "q3",
      "type": "blank",
      "prompt": "A binary heap is a {{1}} tree stored in an {{2}}.",
      "blanks": [
        { "id": "1", "hint": "shape property" },
        { "id": "2", "hint": "backing structure" }
      ],
      "answer": {
        "1": ["complete", "complete binary"],
        "2": ["array", "flat array"]
      },
      "rationale": "The complete-tree shape is what makes the implicit array layout possible."
    },
    {
      "id": "q4",
      "type": "match",
      "prompt": "Match each operation to its worst-case cost on a binary heap.",
      "left": [
        { "id": "l1", "text": "peek max" },
        { "id": "l2", "text": "insert" },
        { "id": "l3", "text": "build heap from array" }
      ],
      "right": [
        { "id": "r1", "text": "O(1)" },
        { "id": "r2", "text": "O(log n)" },
        { "id": "r3", "text": "O(n)" }
      ],
      "answer": { "l1": "r1", "l2": "r2", "l3": "r3" },
      "rationale": "Build-heap is O(n), not O(n log n) — the bound is dominated by the many cheap shallow nodes."
    }
  ]
}
```

- [ ] **Step 2: Write the failing/characterization tests**

Create `test/server-set.test.ts`:

```ts
import { cpSync, mkdtempSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, test } from 'vitest'
import { createServer } from '../lib/server.ts'

const SET_FIXTURE = fileURLToPath(new URL('../examples/set-example', import.meta.url))
const QUIZ_FIXTURE = fileURLToPath(new URL('../examples/all-types', import.meta.url))
const OK = 200
const SET_QUESTION_IDS = ['q1', 'q2', 'q3', 'q4']

function freshDirFrom(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-set-'))
  cpSync(fixture, dir, { recursive: true })
  return dir
}

async function listen(dir: string): Promise<{ server: Server; base: string }> {
  const server = createServer({ dir })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no port')
  }
  return { server, base: `http://127.0.0.1:${address.port}` }
}

let server: Server | undefined

afterEach(() => {
  server?.close()
  server = undefined
})

test('GET /api/answers on a brand new set shuffles order before any run has happened', async () => {
  const started = await listen(freshDirFrom(SET_FIXTURE))
  server = started.server
  const res = await fetch(`${started.base}/api/answers`)
  expect(res.status).toBe(OK)
  const answers = await res.json()
  expect(answers.order).toBeDefined()
  expect([...answers.order].sort()).toEqual(SET_QUESTION_IDS)
})

test('GET /api/answers on a quiz never has an order field', async () => {
  const started = await listen(freshDirFrom(QUIZ_FIXTURE))
  server = started.server
  const res = await fetch(`${started.base}/api/answers`)
  const answers = await res.json()
  expect(answers.order).toBeUndefined()
})
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run test/server-set.test.ts`
Expected: **both already pass.** Task 3's inline `ctx.meta.kind ?? 'quiz'` fix already threads `kind` correctly through `GET /api/answers`; this fixture and these two tests exist to (a) give later tasks something to serve against, and (b) pin this behavior down at the HTTP level before the refactor in the next step touches the same lines.

- [ ] **Step 4: Refactor `lib/server.ts` to a stored `ctx.kind`**

Add `QuizKind` to the type import:

```ts
import type { Meta, Question, QuizKind, ResultPayload } from './types.ts'
```

Add `kind` to `QuizContext`:

```ts
interface QuizContext {
  dir: string
  meta: Meta
  questions: Question[]
  questionIds: string[]
  known: Set<string>
  kind: QuizKind
  emitSubmitted: (payload: ResultPayload) => void
}
```

Set it in `createServer`:

```ts
export function createServer({ dir }: { dir: string }): Server {
  const { meta, questions } = loadFull(dir)
  let server: Server
  const ctx: QuizContext = {
    dir,
    meta,
    questions,
    questionIds: questions.map((q) => q.id),
    known: new Set(questions.map((q) => q.id)),
    kind: meta.kind ?? 'quiz',
    emitSubmitted: (payload) => {
      server.emit('submitted', payload)
    },
  }
  server = createAdaptorServer({ fetch: buildApp(ctx).fetch }) as Server
  return server
}
```

Simplify the three `readAnswers(..., ctx.meta.kind ?? 'quiz')` calls from Task 3 to `readAnswers(..., ctx.kind)` — in `registerAnswers`'s `GET` handler and its `PUT` handler, and in `registerSubmit`:

```ts
app.get('/api/answers', (c) => c.json(readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.kind), OK))
```

```ts
const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.kind)
```

(this second replacement appears twice — once in the `PUT` handler, once in `registerSubmit` — do both)

- [ ] **Step 5: Run the tests, confirm everything still passes**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including the two new tests (now exercising `ctx.kind` instead of the inline expression) and every pre-existing test.

- [ ] **Step 6: Commit**

```bash
git add examples/set-example lib/server.ts test/server-set.test.ts
git commit -m "feat: add a set-kind test fixture and store kind on QuizContext"
```

---

### Task 8: `POST /api/submit` for a set — score, append history, reset and reshuffle

**Files:**
- Modify: `lib/server.ts` (`registerSubmit`)
- Test: `test/server-set.test.ts`

**Interfaces:**
- Consumes: `skeleton`, `appendHistoryEntry` (Tasks 3, 4)

- [ ] **Step 1: Write the failing tests**

Extend `lib/server.ts`'s import from `./quiz.ts` in the test file's own imports — no, this task edits `lib/server.ts` itself, not the test's imports of it; append tests to `test/server-set.test.ts` instead. Add `readFileSync` to that file's `node:fs` import.

Append:

```ts
function putAnswers(base: string, body: unknown): Promise<Response> {
  return fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('submitting a set scores it, appends history, and resets to a fresh reshuffled draft', async () => {
  const dir = freshDirFrom(SET_FIXTURE)
  const started = await listen(dir)
  server = started.server

  await putAnswers(started.base, {
    responses: {
      q1: { value: 'b', flagged: false },
      q2: { value: ['a', 'c'], flagged: false },
      q3: { value: { 1: 'complete', 2: 'array' }, flagged: true },
      q4: { value: { l1: 'r1', l2: 'r2', l3: 'r1' }, flagged: false },
    },
  })

  const res = await fetch(`${started.base}/api/submit`, { method: 'POST' })
  expect(res.status).toBe(OK)
  const body = await res.json()
  expect(body).toEqual({
    ok: true,
    result: {
      correct: 3,
      total: 4,
      perQuestion: { q1: true, q2: true, q3: true, q4: false },
    },
  })

  const history = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'))
  expect(history.runs).toHaveLength(1)
  expect(history.runs[0].correct).toBe(3)
  expect(history.runs[0].flagged).toEqual(['q3'])

  const after = await (await fetch(`${started.base}/api/answers`)).json()
  expect(after.status).toBe('draft')
  expect(after.responses.q1).toEqual({ value: null, flagged: false })
  expect(after.order).toBeDefined()
})

test('a set never becomes unretakeable — submitting twice appends two history runs', async () => {
  const dir = freshDirFrom(SET_FIXTURE)
  const started = await listen(dir)
  server = started.server

  expect((await fetch(`${started.base}/api/submit`, { method: 'POST' })).status).toBe(OK)
  expect((await fetch(`${started.base}/api/submit`, { method: 'POST' })).status).toBe(OK)

  const history = JSON.parse(readFileSync(join(dir, 'history.json'), 'utf8'))
  expect(history.runs).toHaveLength(2)
})

test('submitting a set does not emit "submitted" -- the process must keep running', async () => {
  const started = await listen(freshDirFrom(SET_FIXTURE))
  server = started.server

  let emitted = false
  server.on('submitted', () => {
    emitted = true
  })
  await fetch(`${started.base}/api/submit`, { method: 'POST' })
  expect(emitted).toBe(false)
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run test/server-set.test.ts`
Expected: the first test fails — today's `POST /api/submit` marks `answers.json` as permanently `'submitted'` and responds `{ok: true}` with no `result`; `history.json` is never written. The second test fails because the second submit gets `409`, not `200`. The third test passes already (today's handler only ever emits `'submitted'`, and this asserts it does not for the fixture used here, which happens to already be true, but for the wrong reason — it'll keep passing after the real fix too since a set is never supposed to emit `'submitted'` at all).

- [ ] **Step 3: Implement in `lib/server.ts`**

Add `appendHistoryEntry` and `skeleton` to the import from `./quiz.ts`:

```ts
import { appendHistoryEntry, loadFull, loadPublic, readAnswers, skeleton, writeAnswers } from './quiz.ts'
```

Replace `registerSubmit`:

```ts
function registerSubmit(app: Hono, ctx: QuizContext): void {
  app.post('/api/submit', (c) => {
    const answers = readAnswers(ctx.dir, ctx.meta.id, ctx.questionIds, ctx.kind)
    if (answers.status === 'submitted') {
      return c.json({ error: 'this quiz has already been submitted' }, CONFLICT)
    }

    if (ctx.kind === 'set') {
      const { auto, flagged } = scoreQuiz(ctx.questions, answers.responses)
      appendHistoryEntry(ctx.dir, {
        ranAt: new Date().toISOString(),
        correct: auto.correct,
        total: auto.total,
        perQuestion: auto.perQuestion,
        flagged,
      })
      writeAnswers(ctx.dir, skeleton(ctx.meta.id, ctx.questionIds, 'set'))
      return c.json(
        { ok: true, result: { correct: auto.correct, total: auto.total, perQuestion: auto.perQuestion } },
        OK,
      )
    }

    answers.status = 'submitted'
    answers.submittedAt = new Date().toISOString()
    // Persist before scoring and before emitting: a crash after this point still leaves a
    // submitted attempt on disk, whereas emitting first could announce a result that was
    // never durably recorded.
    writeAnswers(ctx.dir, answers)

    const { auto, needsGrading, flagged } = scoreQuiz(ctx.questions, answers.responses)
    // Respond before emitting so a listener cannot act on the payload while the browser is
    // still waiting on its request.
    const response = c.json({ ok: true }, OK)
    ctx.emitSubmitted({
      quizId: ctx.meta.id,
      quizDir: ctx.dir,
      auto,
      needsGrading,
      flagged,
      responses: answers.responses,
    })
    return response
  })
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including `test/server-submit.test.ts`'s existing quiz-branch tests (untouched code path) and everything else in the suite.

- [ ] **Step 5: Commit**

```bash
git add lib/server.ts test/server-set.test.ts
git commit -m "feat: score, log to history, and reset a set on every submit instead of ending the attempt"
```

---

### Task 9: `POST /api/finish` — only for a set

**Files:**
- Modify: `lib/server.ts` (`QuizContext`, `createServer`, new `registerFinish`, `buildApp`)
- Test: `test/server-set.test.ts`

**Interfaces:**
- Consumes: `readHistory`, `buildFinishPayload` (Task 4)
- Produces: `QuizContext.emitFinished: (payload: FinishPayload) => void`

- [ ] **Step 1: Write the failing tests**

Add `once` to a new `node:events` import, and `NOT_FOUND` alongside `OK` in the constants block, in `test/server-set.test.ts`.

Append:

```ts
import { once } from 'node:events'
// ...
const NOT_FOUND = 404
```

```ts
test('POST /api/finish emits the finish payload with every completed run and responds ok', async () => {
  const dir = freshDirFrom(SET_FIXTURE)
  const started = await listen(dir)
  server = started.server

  await fetch(`${started.base}/api/submit`, { method: 'POST' })
  const emitted = once(server, 'finished')
  const res = await fetch(`${started.base}/api/finish`, { method: 'POST' })
  expect(res.status).toBe(OK)
  const [payload] = await emitted
  expect(payload.quizId).toBe('b7c2')
  expect(payload.quizDir).toBe(dir)
  expect(payload.kind).toBe('set')
  expect(payload.runs).toHaveLength(1)
})

test('POST /api/finish does not exist for a quiz', async () => {
  const started = await listen(freshDirFrom(QUIZ_FIXTURE))
  server = started.server
  const res = await fetch(`${started.base}/api/finish`, { method: 'POST' })
  expect(res.status).toBe(NOT_FOUND)
})
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run test/server-set.test.ts`
Expected: the first test fails — `/api/finish` doesn't exist, so it 404s and `once(server, 'finished')` never resolves (the test will hang/time out; if so, that itself confirms the route is missing — read the actual failure rather than assuming). The second test already passes (everything 404s today).

- [ ] **Step 3: Implement in `lib/server.ts`**

Extend the imports:

```ts
import { appendHistoryEntry, buildFinishPayload, loadFull, loadPublic, readAnswers, readHistory, skeleton, writeAnswers } from './quiz.ts'
```

```ts
import type { FinishPayload, Meta, Question, QuizKind, ResultPayload } from './types.ts'
```

Add `emitFinished` to `QuizContext`:

```ts
interface QuizContext {
  dir: string
  meta: Meta
  questions: Question[]
  questionIds: string[]
  known: Set<string>
  kind: QuizKind
  emitSubmitted: (payload: ResultPayload) => void
  emitFinished: (payload: FinishPayload) => void
}
```

Add the new route handler, right after `registerSubmit`:

```ts
function registerFinish(app: Hono, ctx: QuizContext): void {
  app.post('/api/finish', (c) => {
    const { runs } = readHistory(ctx.dir)
    const response = c.json({ ok: true }, OK)
    ctx.emitFinished(buildFinishPayload(ctx.meta, ctx.dir, runs))
    return response
  })
}
```

Register it conditionally in `buildApp`:

```ts
function buildApp(ctx: QuizContext): Hono {
  const app = new Hono()

  app.get('/api/quiz', (c) => c.json(loadPublic(ctx.dir), OK))
  registerAnswers(app, ctx)
  registerSubmit(app, ctx)
  if (ctx.kind === 'set') {
    registerFinish(app, ctx)
  }
  app.all('/api/*', (c) => c.json({ error: 'unknown endpoint' }, NOT_FOUND))
  app.get('*', serveStatic({ root: DIST_DIR }))

  return app
}
```

Add the closure in `createServer`:

```ts
    emitSubmitted: (payload) => {
      server.emit('submitted', payload)
    },
    emitFinished: (payload) => {
      server.emit('finished', payload)
    },
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/server.ts test/server-set.test.ts
git commit -m "feat: add POST /api/finish for a set, gated on kind"
```

---

### Task 10: `serve.ts` — the `'finished'` event and the kind-aware SIGINT/SIGTERM path

**Files:**
- Modify: `serve.ts` (imports, `main`)
- Modify: `test/support/cli-child.ts` (add `freshSetDir`)
- Test: Create `test/cli-set.test.ts`

**Interfaces:**
- Consumes: `readHistory`, `buildFinishPayload` (Task 4), `FinishPayload` (Task 1)
- Produces: `freshSetDir(): string` in `test/support/cli-child.ts`

- [ ] **Step 1: Add the shared test helper**

Add to `test/support/cli-child.ts`, alongside the existing `FIXTURE` constant and `freshQuizDir`:

```ts
const SET_FIXTURE = fileURLToPath(new URL('../../examples/set-example', import.meta.url))

export function freshSetDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-cli-set-'))
  cpSync(SET_FIXTURE, dir, { recursive: true })
  return dir
}
```

- [ ] **Step 2: Write the failing tests**

Create `test/cli-set.test.ts`:

```ts
import { expect, test } from 'vitest'
import { freshSetDir, start } from './support/cli-child.ts'

const EXIT_OK = 0
const EXIT_ABANDONED = 3

test('SIGTERM with zero completed runs abandons like a quiz', async () => {
  const s = start([freshSetDir()])
  await s.ready
  s.child.kill('SIGTERM')
  expect(await s.exited).toBe(EXIT_ABANDONED)
  expect(s.stdout()).toBe('')
})

test('a submitted run followed by SIGTERM finishes with exit 0 and the runs payload on stdout', async () => {
  const s = start([freshSetDir()])
  const base = await s.ready
  expect((await fetch(`${base}/api/submit`, { method: 'POST' })).status).toBe(200)
  s.child.kill('SIGTERM')
  expect(await s.exited).toBe(EXIT_OK)
  const payload = JSON.parse(s.stdout())
  expect(payload.kind).toBe('set')
  expect(payload.runs).toHaveLength(1)
})

test('clicking finish exits 0 with the runs payload without waiting for a signal', async () => {
  const s = start([freshSetDir()])
  const base = await s.ready
  await fetch(`${base}/api/submit`, { method: 'POST' })
  await fetch(`${base}/api/finish`, { method: 'POST' })
  expect(await s.exited).toBe(EXIT_OK)
  const payload = JSON.parse(s.stdout())
  expect(payload.runs).toHaveLength(1)
})
```

- [ ] **Step 3: Run the tests, confirm they fail**

Run: `npx vitest run test/cli-set.test.ts`
Expected: the first test passes already (today's unconditional abandon-on-signal path happens to produce exit 3 regardless of kind). The second fails: today's SIGINT/SIGTERM handler always abandons, so it exits 3 with nothing on stdout instead of exit 0 with a `runs` payload. The third fails: `/api/finish` exists after Task 9, but nothing in `serve.ts` listens for the `'finished'` event yet, so the process never exits and the test times out — confirm this by reading the actual timeout/failure output.

- [ ] **Step 4: Implement in `serve.ts`**

Add to the `lib/quiz.ts` import:

```ts
import {
  answersPath,
  archiveAnswers,
  buildFinishPayload,
  loadFull,
  QuizError,
  readAnswers,
  readHistory,
  scaffoldQuiz,
} from './lib/quiz.ts'
```

Add to the type import:

```ts
import type { FinishPayload, Meta, Question, ResultPayload } from './lib/types.ts'
```

Replace `main`'s body from the `loadQuiz` call through the signal-handler loop:

```ts
  const { meta, questions } = loadQuiz(opts.dir, opts.retake)
  const kind = meta.kind ?? 'quiz'

  if (opts.check) {
    const summary = { ok: true, title: meta.title, questionCount: questions.length }
    process.stdout.write(`${JSON.stringify(summary, null, JSON_INDENT)}\n`)
    return
  }

  const server = createServer({ dir: opts.dir })

  server.on('submitted', (payload: ResultPayload) => {
    process.stdout.write(`${JSON.stringify(payload, null, JSON_INDENT)}\n`)
    shutdown(server, EXIT_OK)
  })

  server.on('finished', (payload: FinishPayload) => {
    process.stdout.write(`${JSON.stringify(payload, null, JSON_INDENT)}\n`)
    shutdown(server, EXIT_OK)
  })

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      if (kind === 'set') {
        const { runs } = readHistory(opts.dir)
        if (runs.length > 0) {
          const payload = buildFinishPayload(meta, opts.dir, runs)
          process.stdout.write(`${JSON.stringify(payload, null, JSON_INDENT)}\n`)
          shutdown(server, EXIT_OK)
          return
        }
      }
      log('any-quiz: abandoned; the draft is saved and the quiz can be re-served')
      shutdown(server, EXIT_ABANDONED)
    })
  }
```

(The rest of `main` — the `server.on('error', ...)` block and the final `server.listen(...)` call — is unchanged.)

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass, including every pre-existing `test/cli.test.ts` SIGINT/SIGTERM test for a plain quiz (that path is untouched — `kind` is `'quiz'` there, so the new branch's condition is always false and it falls straight through to the existing abandon behavior).

- [ ] **Step 6: Commit**

```bash
git add serve.ts test/support/cli-child.ts test/cli-set.test.ts
git commit -m "feat: serve.ts finishes a set with >=1 run on close, and listens for 'finished'"
```

---

### Task 11: `reorderQuestions` — pure reordering logic for the frontend

**Files:**
- Create: `app/lib/order.ts`
- Test: `test/web-lib.test.ts`

**Interfaces:**
- Produces: `export function reorderQuestions(questions: PublicQuestion[], order?: string[]): PublicQuestion[]`

- [ ] **Step 1: Write the failing tests**

Add `reorderQuestions` to `test/web-lib.test.ts`'s imports (`import { reorderQuestions } from '../app/lib/order.ts'`).

Append:

```ts
test('reorderQuestions returns the same array reference when order is undefined', () => {
  expect(reorderQuestions(questions, undefined)).toBe(questions)
})

test('reorderQuestions reorders by the given id sequence', () => {
  const ids = questions.map((each) => each.id)
  const reversed = [...ids].reverse()
  expect(reorderQuestions(questions, reversed).map((each) => each.id)).toEqual(reversed)
})

test('reorderQuestions drops stale ids and appends ids missing from order', () => {
  const [first, second] = questions
  if (!first || !second) {
    throw new Error('fixture drifted')
  }
  const result = reorderQuestions(questions, [second.id, 'nonexistent'])
  expect(result[0]?.id).toBe(second.id)
  expect(result).toHaveLength(questions.length)
  expect(result.map((each) => each.id).sort()).toEqual(questions.map((each) => each.id).sort())
})
```

- [ ] **Step 2: Run the tests, confirm they fail on the missing module**

Run: `npx vitest run test/web-lib.test.ts`
Expected: fails to resolve `../app/lib/order.ts` — a module-not-found error, not an assertion failure.

- [ ] **Step 3: Implement `app/lib/order.ts`**

```ts
import type { PublicQuestion } from '../../lib/types.ts'

// A question id in `order` with no matching question (a stale id from a since-edited
// questions.json) is dropped rather than kept as undefined; a question missing from
// `order` (added after the last shuffle) is appended in its original position instead
// of vanishing from the page.
export function reorderQuestions(
  questions: PublicQuestion[],
  order?: string[],
): PublicQuestion[] {
  if (order === undefined) {
    return questions
  }
  const byId = new Map(questions.map((question) => [question.id, question]))
  const ordered: PublicQuestion[] = []
  for (const id of order) {
    const question = byId.get(id)
    if (question !== undefined) {
      ordered.push(question)
    }
  }
  const seen = new Set(ordered.map((question) => question.id))
  const remaining = questions.filter((question) => !seen.has(question.id))
  return [...ordered, ...remaining]
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/web-lib.test.ts && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/order.ts test/web-lib.test.ts
git commit -m "feat: add reorderQuestions for rendering a set's shuffled order"
```

---

### Task 12: Frontend — set-mode submit, run-again, and finish (`useQuiz.ts` + `Quiz.tsx`)

**Files:**
- Modify: `app/useQuiz.ts`
- Modify: `app/Quiz.tsx`
- Test: `app/quiz.test.tsx`

**Interfaces:**
- Consumes: `reorderQuestions` (Task 11), `Meta.kind`, `Answers.order` (Task 1)
- Produces: `QuizState.runResult: { correct: number; total: number } | null`
- Produces: `QuizState.finish: () => void`
- Produces: `QuizState.clearRunResult: () => void`

A dedicated `useQuiz.ts`-only test isn't possible here without also having `Quiz.tsx`'s UI in place — this codebase tests the hook only through the rendered component (there is no standalone `useQuiz.test.ts`) — so both files change together in one task.

- [ ] **Step 1: Write the failing tests**

In `app/quiz.test.tsx`, add `SET_META` after `META`:

```ts
const SET_META: Meta = { ...META, id: 'b7c2', kind: 'set' }
```

Change the `draft` helper to accept an optional order:

```ts
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
```

Add `finishes`, `currentMeta`, and `submitResult` to the module-level `let` block:

```ts
let puts: Record<string, ResponseEntry>[]
let submits: number
let finishes: number
let answers: Answers
let currentMeta: Meta
let submitResult: unknown
let quizStatus: number
let putStatus: number
let submitStatus: number
```

Replace the `beforeEach` block:

```ts
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
```

Append the new tests:

```ts
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
  submitResult = { ok: true, result: { correct: 1, total: 2, perQuestion: { q1: true, q2: false } } }
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
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run app/quiz.test.tsx`
Expected: the reorder test fails (questions still render in fixture order). The four set-specific tests fail — there is no "Check answers" label, no run-result footer, and no `finish()` action yet.

- [ ] **Step 3: Implement in `app/useQuiz.ts`**

Change the type import:

```ts
import type { Answers, AnswerValue, Meta, PublicQuestion, QuizKind, ResponseEntry } from '../lib/types.ts'
```

Add the new import:

```ts
import { reorderQuestions } from './lib/order.ts'
```

Change `Loaded` to add `order`:

```ts
interface Loaded extends QuizData {
  responses: Responses
  order?: string[]
  submitted: boolean
}
```

Add, near the other interfaces:

```ts
interface SubmitResult {
  correct: number
  total: number
  perQuestion: Record<string, boolean>
}
```

Change `SubmitDeps`:

```ts
interface SubmitDeps {
  kind: QuizKind
  latest: RefObject<Responses>
  cancel: () => void
  setStatus: (status: Status) => void
  setError: (message: string | null) => void
  setRunResult: (result: { correct: number; total: number } | null) => void
  refetchAnswers: () => Promise<void>
}
```

Change `postSubmit` (was `Promise<void>`):

```ts
// A quiz's submit response is `{ok: true}`; a set's is `{ok: true, result: {...}}` --
// `result` is undefined for a quiz and read only by the 'set' branch in useSubmit.
async function postSubmit(): Promise<SubmitResult | null> {
  const res = await fetch('/api/submit', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`submitting failed (${res.status})`)
  }
  const body = (await res.json()) as { result?: SubmitResult }
  return body.result ?? null
}
```

Add, right after `postSubmit`:

```ts
async function postFinish(): Promise<void> {
  const res = await fetch('/api/finish', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`finishing failed (${res.status})`)
  }
}
```

Change `useLoad`'s `onLoad` call to include `order`:

```ts
      onLoad({
        ...quiz,
        responses: saved.responses,
        order: saved.order,
        submitted: saved.status === 'submitted',
      })
```

Change `useSubmit`:

```ts
function useSubmit(deps: SubmitDeps): () => void {
  const { kind, latest, cancel, setStatus, setError, setRunResult, refetchAnswers } = deps
  return useCallback(() => {
    cancel()
    setStatus('submitting')
    setError(null)
    putResponses(latest.current)
      .then(postSubmit)
      .then(async (result) => {
        if (kind === 'set') {
          if (result === null) {
            setRunResult(null)
          } else {
            setRunResult({ correct: result.correct, total: result.total })
          }
          await refetchAnswers()
          setStatus('ready')
          return
        }
        setStatus('submitted')
      })
      .catch((err: unknown) => {
        setStatus('ready')
        setError(`${describe(err)} — your answers were not sent.`)
      })
  }, [cancel, kind, latest, refetchAnswers, setError, setRunResult, setStatus])
}
```

Add, right after `useSubmit`:

```ts
function useFinish(deps: {
  cancel: () => void
  setStatus: (status: Status) => void
  setError: (message: string | null) => void
}): () => void {
  const { cancel, setStatus, setError } = deps
  return useCallback(() => {
    cancel()
    setStatus('submitting')
    setError(null)
    postFinish()
      .then(() => {
        setStatus('submitted')
      })
      .catch((err: unknown) => {
        setStatus('ready')
        setError(`${describe(err)} — could not finish.`)
      })
  }, [cancel, setError, setStatus])
}
```

Change `QuizState`:

```ts
export interface QuizState {
  status: Status
  meta: Meta | null
  questions: PublicQuestion[]
  responses: Responses
  error: string | null
  runResult: { correct: number; total: number } | null
  setValue: (id: string, value: AnswerValue) => void
  toggleFlag: (id: string) => void
  submit: () => void
  finish: () => void
  clearRunResult: () => void
}
```

Change `useQuiz`:

```ts
export function useQuiz(): QuizState {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<QuizData | null>(null)
  const [order, setOrder] = useState<string[] | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{ correct: number; total: number } | null>(null)
  const { queue, cancel } = useAutosave(setError)
  const { responses, latest, seed, setValue, toggleFlag } = useEditor(queue)
  const kind: QuizKind = data?.meta.kind ?? 'quiz'

  const refetchAnswers = useCallback(async () => {
    const saved = await getJson<Answers>('/api/answers')
    seed(saved.responses)
    setOrder(saved.order)
  }, [seed])

  const submit = useSubmit({ kind, latest, cancel, setStatus, setError, setRunResult, refetchAnswers })
  const finish = useFinish({ cancel, setStatus, setError })

  const clearRunResult = useCallback(() => {
    setRunResult(null)
  }, [])

  const onLoad = useCallback(
    (loaded: Loaded) => {
      seed(loaded.responses)
      setOrder(loaded.order)
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

  useEffect(() => {
    if (data?.meta.title) {
      document.title = `${data.meta.title} - AnyQuiz`
    }
  }, [data?.meta.title])

  return {
    status,
    meta: data?.meta ?? null,
    questions: reorderQuestions(data?.questions ?? [], order),
    responses,
    error,
    runResult,
    setValue,
    toggleFlag,
    submit,
    finish,
    clearRunResult,
  }
}
```

- [ ] **Step 4: Implement in `app/Quiz.tsx`**

Add new label constants near the existing ones:

```ts
const CHECK_ANSWERS = 'Check answers'
const RUN_AGAIN = 'Run again'
const FINISH_STUDYING = 'Finish studying'
```

Change `doneLabel` and `FooterProps`:

```ts
function doneLabel(confirming: boolean, sending: boolean, isSet: boolean): string {
  if (sending) {
    return SENDING
  }
  if (confirming) {
    return SEND_ANYWAY
  }
  if (isSet) {
    return CHECK_ANSWERS
  }
  return DONE
}
```

```ts
interface FooterProps {
  answered: number
  total: number
  flagged: number
  confirming: boolean
  sending: boolean
  isSet: boolean
  error: string | null
  onDone: () => void
  onCancel: () => void
}
```

Change `Footer` to destructure and pass `isSet`:

```ts
function Footer(props: FooterProps): ReactElement {
  const { answered, total, flagged, confirming, sending, isSet, error, onDone, onCancel } = props
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
        {doneLabel(confirming, sending, isSet)}
      </button>
    </footer>
  )
}
```

Add, right after `Footer`:

```ts
function scoreLabel(correct: number, total: number): string {
  return `${correct}/${total}`
}

function RunResultFooter({
  correct,
  total,
  onRunAgain,
  onFinish,
}: {
  correct: number
  total: number
  onRunAgain: () => void
  onFinish: () => void
}): ReactElement {
  return (
    <footer>
      <span className="progress">{scoreLabel(correct, total)}</span>
      <button className="run-again" onClick={onRunAgain} type="button">
        {RUN_AGAIN}
      </button>
      <button className="done" onClick={onFinish} type="button">
        {FINISH_STUDYING}
      </button>
    </footer>
  )
}
```

Change `Quiz`:

```ts
export function Quiz(): ReactElement {
  const {
    status,
    meta,
    questions,
    responses,
    error,
    setValue,
    toggleFlag,
    submit,
    runResult,
    clearRunResult,
    finish,
  } = useQuiz()
  const [confirming, setConfirming] = useState(false)
  const { answered, total, flagged } = summarize(questions, responses)
  const isSet = meta?.kind === 'set'

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

  let footer: ReactElement
  if (runResult === null) {
    footer = (
      <Footer
        answered={answered}
        confirming={confirming}
        error={error}
        flagged={flagged}
        isSet={isSet}
        onCancel={handleCancel}
        onDone={handleDone}
        sending={status === 'submitting'}
        total={total}
      />
    )
  } else {
    footer = (
      <RunResultFooter
        correct={runResult.correct}
        onFinish={finish}
        onRunAgain={clearRunResult}
        total={runResult.total}
      />
    )
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
      {footer}
    </>
  )
}
```

- [ ] **Step 5: Run the tests, confirm they pass**

Run: `npx vitest run app/quiz.test.tsx && npx tsc --noEmit`
Expected: all pass, including every pre-existing test in the file (a plain quiz never sets `runResult`, so it always takes the `Footer` branch with `isSet={false}`, which is exactly today's behavior).

- [ ] **Step 6: Run the full frontend suite**

Run: `npx vitest run`
Expected: every test file passes — this file's changes don't touch `Card`, `Prompt`, `Alert`, `Confirmation`, or any per-question-type component.

- [ ] **Step 7: Commit**

```bash
git add app/useQuiz.ts app/Quiz.tsx app/quiz.test.tsx
git commit -m "feat: frontend run-again/finish flow for a flash card set"
```

---

### Task 13: Document flash card sets in all three harness `SKILL.md` adapters

**Files:**
- Modify: `skills/any-quiz/SKILL.md`
- Modify: `pi-skills/any-quiz/SKILL.md`
- Modify: `codex-skills/any-quiz/SKILL.md`

No tests — documentation, depending on Tasks 1–10 being real and correct since it advertises exact flags and JSON shapes.

- [ ] **Step 1: Add a "Flash card sets" section to each file**

Insert this section right after the numbered `## Procedure` and before `## Question schema` in each file, substituting the harness's own invocation prefix (`${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs` for `skills/any-quiz/SKILL.md`; `../../bin/any-quiz.mjs` for the other two):

```markdown
## Flash card sets

Use this instead of a one-shot quiz when the user wants to drill material repeatedly in one sitting — "make me a flash card set on X", "let me drill X", "quiz me on X until I get it." A set restricts questions to the four self-scoring types (`mcq`/`multi`/`blank`/`match` — no `short`/`code`, since a set never grades through you) and can be run as many times as the user wants before they're done.

### Author it

Same as step 1, with `--kind set`:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs" scaffold ~/.any-quiz <slug> "<title>" "<topic>" --kind set
```

Everything else — writing `questions.json`, `--check`, serving — is identical to a quiz. The server reshuffles question order every run and reports each run's score the instant the user submits it; it keeps running until the user clicks "Finish studying" or closes the tab.

### Wrap-up

The process exits once the user finishes the sitting (or SIGINT/SIGTERM catches it having completed at least one run). stdout is:

```json
{
  "quizId": "b7c2",
  "quizDir": "/Users/you/.any-quiz/2026-08-25-heap-basics-set-b7c2",
  "kind": "set",
  "runs": [
    { "ranAt": "2026-08-25T14:05:02Z", "correct": 3, "total": 4, "perQuestion": { "q1": true, "q2": false, "q3": true, "q4": true }, "flagged": ["q2"] }
  ]
}
```

There's no grading step — every type in a set is auto-scored. Report the score trend across `runs` (improving, flat, or worse) and which card ids came up wrong most often. Offer to keep drilling (re-serve the same folder — a set never becomes unretakeable) or move to a new topic.
```

- [ ] **Step 2: Extend the "## Flags" section in each file**

Replace:

```markdown
`scaffold`'s own flags: `--parent <id>` sets `parentQuizId`; repeatable `--target <id>` sets `targets`.
```

with:

```markdown
`scaffold`'s own flags: `--parent <id>` sets `parentQuizId`; repeatable `--target <id>` sets `targets`; `--kind set` marks the folder a flash card set (omit for a normal quiz).
```

- [ ] **Step 3: Update the "## Exit codes" line in each file**

Replace:

```markdown
`0` submitted · `2` invalid quiz or refused start · `3` abandoned
```

with:

```markdown
`0` submitted (quiz) or finished with ≥1 run (set) · `2` invalid quiz or refused start · `3` abandoned (quiz) or closed with zero runs completed (set)
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: passes (Markdown isn't linted by this repo's Biome config; this confirms the doc edits didn't accidentally touch a tracked source file).

Read all three edited files back and confirm: each new code block's invocation prefix matches that file's existing convention, and the section reads consistently with the rest of that file's tone and structure.

- [ ] **Step 5: Commit**

```bash
git add skills/any-quiz/SKILL.md pi-skills/any-quiz/SKILL.md codex-skills/any-quiz/SKILL.md
git commit -m "docs: document flash card sets in all three harness adapters"
```

---

### Task 14: Rebuild and commit the bundles

**Files:**
- Modify: `app/dist/**`, `app/dist/.buildinfo.json`, `bin/any-quiz.mjs`, `bin/.buildinfo.json`

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: lint, typecheck, and every test file (node + jsdom projects) pass clean.

- [ ] **Step 2: Rebuild**

Run: `npm run build`
Expected: `vite build` regenerates `app/dist/**`, `esbuild` regenerates `bin/any-quiz.mjs`, and `tools/stamp-build.ts` rewrites both `.buildinfo.json` stamps.

- [ ] **Step 3: Confirm the bundle is fresh**

Run: `npm run check`
Expected: `test/buildinfo.test.ts` and `test/bin-bundle.test.ts` pass (they fail on a stale bundle, so a green run here proves the rebuild actually happened and captured everything from Tasks 1–13, including the new `app/lib/order.ts` and `examples/set-example/` fixture).

- [ ] **Step 4: Commit**

```bash
git add app/dist bin/any-quiz.mjs bin/.buildinfo.json app/dist/.buildinfo.json
git commit -m "build: rebuild bundles for flash card sets"
```

---

## Self-Review

**Spec coverage** (against `docs/superpowers/specs/2026-08-21-flash-card-sets-design.md` as revised):

- `meta.json`'s `kind` field, and its 2026-08-25 addendum that it must be written via `scaffoldQuiz`/`--kind set`, not hand-written → Tasks 1, 5, 6.
- `questions.json` validation rejecting `short`/`code` in a set → Task 2.
- `answers.json`'s `order` field and the skeleton shuffle, plus the addendum that `readAnswers` must carry `kind` (the reshuffle-on-first-run fix) → Tasks 1, 3, 7 (fixture + regression test).
- `history.json` (new file, sets only) → Task 4.
- Server: `QuizContext.kind`, `GET`/`PUT /api/answers` passing `kind` through, `POST /api/submit` branching, `POST /api/finish` gated on kind, plus the addendum that the finish payload needs its own type and a shared `buildFinishPayload` helper → Tasks 1, 4, 7, 8, 9.
- CLI: `'finished'` event, SIGINT/SIGTERM branching on kind and run count, the addendum that `loadQuiz`'s retake check also needs the new required `kind` argument → Tasks 3 (loadQuiz call site), 10.
- Frontend: reorder by `answers.order`, `runResult`, submit branching, `finish()`, Done-label swap → Tasks 11, 12.
- Skill docs: authoring with `--kind set`, wrap-up section, exit code table → Task 13.
- Testing section's specific call-outs (`question-schema` set-kind rejection, `quiz.ts` history and skeleton-shuffle tests, the `readAnswers`-with-no-file regression case, `scaffoldQuiz`/`--kind` round-trip, server submit-for-set and `/api/finish` gating, CLI `'finished'`/SIGINT branching, frontend run-again/finish/Done-label tests, and the rebuilt-bundle check) → covered in the task each behavior belongs to.
- Non-goals (spaced repetition, tab-close detection beyond existing SIGINT/SIGTERM, a history-browsing UI) — deliberately not built; nothing in this plan does more than the spec asks.

**Placeholder scan:** every step has real, complete code — no TBD/TODO, no "add appropriate handling," no "similar to Task N" left unexpanded.

**Type consistency:** `QuizKind`/`HistoryEntry`/`HistoryDoc`/`FinishPayload` (Task 1) are the exact names imported in every later task. `skeleton(quizId, questionIds, kind)` and `readAnswers(dir, quizId, questionIds, kind)` (Task 3) keep that exact parameter order and required `kind` everywhere they're called (Tasks 7, 8). `QuizContext.kind`/`emitFinished` (Tasks 7, 9) match their usage in `registerAnswers`/`registerSubmit`/`registerFinish`. `SubmitResult`/`QuizState.runResult`/`QuizState.finish`/`QuizState.clearRunResult` (Task 12) are used with the same shape in both `useQuiz.ts` and `Quiz.tsx`. `buildFinishPayload(meta, dir, runs)` (Task 4) is called with that exact argument order in both `lib/server.ts` (Task 9) and `serve.ts` (Task 10).
