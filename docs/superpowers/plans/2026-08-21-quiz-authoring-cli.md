# Quiz Authoring CLI (add-question + report) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two `serve.ts` subcommands — `add-question` (append and validate one question at a time instead of hand-writing the whole `questions.json` array) and `report` (join `questions.json` + `answers.json` server-side into a compact, coaching-ready view) — and wire both into all three harness `SKILL.md` adapters.

**Architecture:** Both subcommands follow the existing `scaffold`/`--check` pattern established in `serve.ts` and `lib/quiz.ts`: a pure CLI-arg parser + a FS/domain function in `lib/`, dispatched from the same `if (invokedDirectly())` block. `add-question` reuses the existing Zod validator (`validateQuestions`) instead of adding new validation rules — an invalid question is rejected and the file is left untouched. `report` reuses the existing scoring logic (`scoreQuestion`, `CLOSED_TYPES`) instead of re-implementing correctness, and adds a resolution layer that turns choice/pair ids into their display text so the coaching step no longer needs to read raw `questions.json`.

**Tech Stack:** TypeScript, Node ≥22.18, Vitest (real child-process + real FS in tests, no mocks), Zod (existing `validateQuestions`), Biome (preset `all`).

**Spec:** No separate spec doc — scope and design were agreed conversationally (see the two prior turns: "is there a cli way to add a question... and a way to read a quiz results... token efficient"). This plan is the spec of record for those two features.

## Global Constraints

- Reuse the existing validator (`validateQuestions` in `lib/question-schema.ts`) for every new question-writing path. Do not add new validation rules anywhere else.
- Reuse the existing scoring logic (`scoreQuestion`, `CLOSED_TYPES`, and the newly-exported `asStrings`/`asRecord` guards in `lib/score.ts`) for the report. Do not re-implement correctness checks.
- Every write to `questions.json` is atomic: write to `<path>.tmp`, then `renameSync` — matching `writeAnswers`'s existing pattern in `lib/quiz.ts`.
- CLI stdout carries exactly one JSON payload per invocation; everything human-readable goes through `log()` (stderr) or `fail()`.
- Exit codes stay `0` / `2` / `3` — no new exit codes.
- No new runtime dependencies. Node ≥22.18 only.
- `biome check .` (preset `all`) and `tsc --noEmit` must pass after every task. This repo's pre-write hook runs `biome check` on every edit — keep magic numbers named, and never place a non-exported declaration after an exported one in the same file (`useExportsLast`).
- `npm run build` must be re-run and its output (`app/dist/`, `bin/any-quiz.mjs`) committed before the feature is done — `test/buildinfo.test.ts` fails on a stale bundle.
- All three harness adapters (`skills/any-quiz/SKILL.md`, `pi-skills/any-quiz/SKILL.md`, `codex-skills/any-quiz/SKILL.md`) get identical documentation changes except for the harness-specific invocation prefix (`${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs` vs `../../bin/any-quiz.mjs`), per `.claude/skills/harness-ports/SKILL.md`.

---

### Task 1: `addQuestion` in `lib/quiz.ts`

**Files:**
- Modify: `lib/quiz.ts` — add `questionsPath`, refactor `loadFull` to use it, add `addQuestion`, rename `META_INDENT` → `JSON_INDENT` (it now writes two different JSON files)
- Test: `test/quiz.test.ts`

**Interfaces:**
- Produces: `export function questionsPath(dir: string): string`
- Produces: `export function addQuestion(dir: string, candidate: Record<string, unknown>): Question[]`
- Consumes (already in `lib/quiz.ts`): `QuizError`, `validateQuestions`, `readJson` (private), `QuestionsDoc`, `Question` (from `./types.ts`)

- [ ] **Step 1: Write the failing tests**

Add to `test/quiz.test.ts` (needs `addQuestion`, `questionsPath` added to the existing import from `../lib/quiz.ts`):

```ts
const mcqCandidate = {
  id: 'q99',
  type: 'mcq',
  prompt: 'Pick b',
  answer: 'b',
  rationale: 'b is correct',
  choices: [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ],
}

test('addQuestion creates questions.json when none exists yet', () => {
  const dir = tmp()
  const questions = addQuestion(dir, mcqCandidate)
  expect(questions).toHaveLength(1)
  expect(JSON.parse(readFileSync(questionsPath(dir), 'utf8')).questions).toHaveLength(1)
})

test('addQuestion appends to an existing questions.json', () => {
  const dir = tmp()
  writeFileSync(
    questionsPath(dir),
    JSON.stringify({ version: 1, questions: [{ ...mcqCandidate, id: 'q1' }] }),
  )
  const questions = addQuestion(dir, mcqCandidate)
  expect(questions.map((q) => q.id)).toEqual(['q1', 'q99'])
})

test('addQuestion rejects an invalid candidate and leaves the file untouched', () => {
  const dir = tmp()
  addQuestion(dir, mcqCandidate)
  const before = readFileSync(questionsPath(dir), 'utf8')
  const attempt = () => addQuestion(dir, { ...mcqCandidate, id: 'q100', answer: undefined })
  expect(attempt).toThrow(QuizError)
  try {
    attempt()
  } catch (err) {
    expect((err as InstanceType<typeof QuizError>).errors.join('\n')).toMatch(MISSING_ANSWER_RE)
  }
  expect(readFileSync(questionsPath(dir), 'utf8')).toBe(before)
})

test('addQuestion rejects a duplicate id', () => {
  const dir = tmp()
  addQuestion(dir, mcqCandidate)
  expect(() => addQuestion(dir, mcqCandidate)).toThrow(QuizError)
})
```

- [ ] **Step 2: Run the tests, confirm they fail on the missing export**

Run: `npx vitest run test/quiz.test.ts`
Expected: 4 failures, each `TypeError: addQuestion is not a function` (or `questionsPath is not a function`) — not an assertion failure. If any test fails with a different message, fix the test before continuing.

- [ ] **Step 3: Implement in `lib/quiz.ts`**

Rename the existing `META_INDENT` constant to `JSON_INDENT` everywhere it's used in this file (currently only inside `scaffoldQuiz`'s `writeFileSync` call).

Change the `loadFull` line that currently reads:
```ts
const doc = readJson(join(dir, 'questions.json'), 'questions.json')
```
to:
```ts
const doc = readJson(questionsPath(dir), 'questions.json')
```

Add, right after `answersPath` (which already exists in this file):
```ts
export function questionsPath(dir: string): string {
  return join(dir, 'questions.json')
}
```

Add at the end of the file, after `scaffoldQuiz` and before the final `export { TYPES, validateQuestions } from './question-schema.ts'` / `export { QuizError }` lines:
```ts
export function addQuestion(dir: string, candidate: Record<string, unknown>): Question[] {
  const path = questionsPath(dir)
  const existing = existsSync(path)
    ? (readJson(path, 'questions.json') as QuestionsDoc)
    : { version: 1 as const, questions: [] }
  const doc: QuestionsDoc = {
    version: 1,
    questions: [...existing.questions, candidate as Question],
  }
  const errors = validateQuestions(doc)
  if (errors.length > 0) {
    throw new QuizError('questions.json failed validation', errors)
  }
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, `${JSON.stringify(doc, null, JSON_INDENT)}\n`)
  renameSync(tmpPath, path)
  return doc.questions
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/quiz.test.ts`
Expected: all tests pass (the 4 new ones plus every existing test in the file — this file's existing tests must not regress).

- [ ] **Step 5: Commit**

```bash
git add lib/quiz.ts test/quiz.test.ts
git commit -m "feat: add addQuestion for appending one validated question at a time"
```

---

### Task 2: `parseAddQuestionArgs` + `buildQuestionCandidate` in `serve.ts` (pure parsing)

**Files:**
- Modify: `serve.ts` — add the `Choice`/`Blank` type import, `ADD_QUESTION_USAGE`, `splitPair`, `deriveAnswer`, `AddQuestionArgs`, `parseAddQuestionArgs`, `buildQuestionCandidate`
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `Choice`, `Blank` types from `./lib/types.ts` (already exported there)
- Produces: `export interface AddQuestionArgs { dir: string | null; id: string | null; type: string | null; prompt: string | null; rationale: string | null; language: string | null; answers: string[]; choices: Choice[]; blanks: Blank[]; accepts: Array<{ blankId: string; text: string }>; left: Choice[]; right: Choice[]; matches: Array<{ left: string; right: string }> }`
- Produces: `export function parseAddQuestionArgs(argv: string[]): AddQuestionArgs`
- Produces: `export function buildQuestionCandidate(args: AddQuestionArgs): Record<string, unknown>`

- [ ] **Step 1: Write the failing tests**

Add `readFileSync` and `existsSync` to `test/cli.test.ts`'s `node:fs` import if not already there (Task 3 needs them too — add both now), and add `buildQuestionCandidate, parseAddQuestionArgs` to the existing `import { parseArgs } from '../serve.ts'` line. Add these tests:

```ts
test('parseAddQuestionArgs and buildQuestionCandidate assemble an mcq question', () => {
  const args = parseAddQuestionArgs([
    '/tmp/quiz',
    '--id',
    'q1',
    '--type',
    'mcq',
    '--prompt',
    'Pick b',
    '--choice',
    'a:A',
    '--choice',
    'b:B',
    '--answer',
    'b',
    '--rationale',
    'b is right',
  ])
  expect(args.dir).toBe('/tmp/quiz')
  expect(buildQuestionCandidate(args)).toEqual({
    id: 'q1',
    type: 'mcq',
    prompt: 'Pick b',
    rationale: 'b is right',
    answer: 'b',
    choices: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
  })
})

test('parseAddQuestionArgs accumulates repeated --answer flags for multi', () => {
  const args = parseAddQuestionArgs([
    '/tmp/quiz',
    '--id',
    'q4',
    '--type',
    'multi',
    '--prompt',
    'Pick all evens',
    '--choice',
    'a:2',
    '--choice',
    'b:3',
    '--choice',
    'c:4',
    '--answer',
    'a',
    '--answer',
    'c',
  ])
  expect(buildQuestionCandidate(args).answer).toEqual(['a', 'c'])
})

test('parseAddQuestionArgs groups repeated --accept flags per blank id', () => {
  const args = parseAddQuestionArgs([
    '/tmp/quiz',
    '--id',
    'q2',
    '--type',
    'blank',
    '--prompt',
    'A {{shape}} tree.',
    '--blank',
    'shape:what kind of tree',
    '--accept',
    'shape:complete',
    '--accept',
    'shape:complete binary',
  ])
  const candidate = buildQuestionCandidate(args)
  expect(candidate.blanks).toEqual([{ id: 'shape', hint: 'what kind of tree' }])
  expect(candidate.answer).toEqual({ shape: ['complete', 'complete binary'] })
})

test('parseAddQuestionArgs pairs --match flags into a left-to-right answer map', () => {
  const args = parseAddQuestionArgs([
    '/tmp/quiz',
    '--id',
    'q3',
    '--type',
    'match',
    '--prompt',
    'Match them',
    '--left',
    'l1:Stack',
    '--left',
    'l2:Queue',
    '--right',
    'r1:LIFO',
    '--right',
    'r2:FIFO',
    '--match',
    'l1:r1',
    '--match',
    'l2:r2',
  ])
  const candidate = buildQuestionCandidate(args)
  expect(candidate.left).toEqual([
    { id: 'l1', text: 'Stack' },
    { id: 'l2', text: 'Queue' },
  ])
  expect(candidate.answer).toEqual({ l1: 'r1', l2: 'r2' })
})
```

- [ ] **Step 2: Run the tests, confirm they fail on the missing export**

Run: `npx vitest run test/cli.test.ts`
Expected: the 4 new tests fail with `parseAddQuestionArgs is not a function` (or a TypeScript error at import time — either way, a missing-export failure, not an assertion failure).

- [ ] **Step 3: Implement in `serve.ts`**

Change the type import line:
```ts
import type { Meta, Question, ResultPayload } from './lib/types.ts'
```
to:
```ts
import type { Blank, Choice, Meta, Question, ResultPayload } from './lib/types.ts'
```

Add near the other usage constants (after `SCAFFOLD_USAGE`):
```ts
const ADD_QUESTION_USAGE = [
  'usage: serve.ts add-question <quiz-dir> --id <id> --type <type> --prompt <text> [--rationale <text>]',
  '  mcq/multi:  --choice <id>:<text> (2+)   --answer <choiceId>  (multi: repeat --answer)',
  '  blank:      --blank <id>[:<hint>] (1+)  --accept <blankId>:<text> (1+ per blank)',
  '  match:      --left <id>:<text> (2+)     --right <id>:<text> (2+)   --match <leftId>:<rightId>',
  '  short:      --answer <text>',
  '  code:       --language <lang>           --answer <text>',
].join('\n')
```

Add near the other private helpers, before `resolveOptions` (these must sit before any `export` in the file, per `useExportsLast`):
```ts
function splitPair(value: string | undefined, flag: string): [string, string] {
  if (value === undefined) {
    fail(`${flag} needs a value`)
  }
  const sep = value.indexOf(':')
  if (sep === -1) {
    fail(`${flag} needs an "id:value" pair, got "${value}"`)
  }
  return [value.slice(0, sep), value.slice(sep + 1)]
}

function deriveAnswer(type: string, args: AddQuestionArgs): unknown {
  if (type === 'multi') {
    return args.answers
  }
  if (type === 'blank') {
    const grouped: Record<string, string[]> = {}
    for (const { blankId, text } of args.accepts) {
      ;(grouped[blankId] ??= []).push(text)
    }
    return grouped
  }
  if (type === 'match') {
    const grouped: Record<string, string> = {}
    for (const { left, right } of args.matches) {
      grouped[left] = right
    }
    return grouped
  }
  return args.answers[0]
}
```

Add at the very end of the file, after the existing `export function parseScaffoldArgs` (this keeps every trailing declaration an export, satisfying `useExportsLast`):
```ts
export interface AddQuestionArgs {
  dir: string | null
  id: string | null
  type: string | null
  prompt: string | null
  rationale: string | null
  language: string | null
  answers: string[]
  choices: Choice[]
  blanks: Blank[]
  accepts: Array<{ blankId: string; text: string }>
  left: Choice[]
  right: Choice[]
  matches: Array<{ left: string; right: string }>
}

// Positional: <quiz-dir>. Everything else is a flag; `--choice`/`--left`/`--right`/`--match`
// are repeatable "id:value" pairs, `--blank` is "id" or "id:hint", `--answer` accumulates (a
// scalar for mcq/short/code, a set for multi) and `--accept` accumulates per blank id.
export function parseAddQuestionArgs(argv: string[]): AddQuestionArgs {
  const out: AddQuestionArgs = {
    dir: null,
    id: null,
    type: null,
    prompt: null,
    rationale: null,
    language: null,
    answers: [],
    choices: [],
    blanks: [],
    accepts: [],
    left: [],
    right: [],
    matches: [],
  }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    i += 1
    if (arg === '--id') {
      out.id = argv[i] ?? null
      i += 1
    } else if (arg === '--type') {
      out.type = argv[i] ?? null
      i += 1
    } else if (arg === '--prompt') {
      out.prompt = argv[i] ?? null
      i += 1
    } else if (arg === '--rationale') {
      out.rationale = argv[i] ?? null
      i += 1
    } else if (arg === '--language') {
      out.language = argv[i] ?? null
      i += 1
    } else if (arg === '--answer') {
      const value = argv[i]
      if (value !== undefined) {
        out.answers.push(value)
      }
      i += 1
    } else if (arg === '--choice') {
      const [id, text] = splitPair(argv[i], '--choice')
      out.choices.push({ id, text })
      i += 1
    } else if (arg === '--left') {
      const [id, text] = splitPair(argv[i], '--left')
      out.left.push({ id, text })
      i += 1
    } else if (arg === '--right') {
      const [id, text] = splitPair(argv[i], '--right')
      out.right.push({ id, text })
      i += 1
    } else if (arg === '--match') {
      const [left, right] = splitPair(argv[i], '--match')
      out.matches.push({ left, right })
      i += 1
    } else if (arg === '--accept') {
      const [blankId, text] = splitPair(argv[i], '--accept')
      out.accepts.push({ blankId, text })
      i += 1
    } else if (arg === '--blank') {
      const value = argv[i]
      i += 1
      if (value === undefined) {
        fail('--blank needs a value')
      }
      const sep = value.indexOf(':')
      out.blanks.push(sep === -1 ? { id: value } : { id: value.slice(0, sep), hint: value.slice(sep + 1) })
    } else if (out.dir === null && arg !== undefined) {
      out.dir = arg
    }
  }
  return out
}

export function buildQuestionCandidate(args: AddQuestionArgs): Record<string, unknown> {
  const candidate: Record<string, unknown> = {
    id: args.id ?? undefined,
    type: args.type ?? undefined,
    prompt: args.prompt ?? undefined,
    rationale: args.rationale ?? undefined,
    answer: deriveAnswer(args.type ?? '', args),
  }
  if (args.choices.length > 0) {
    candidate.choices = args.choices
  }
  if (args.blanks.length > 0) {
    candidate.blanks = args.blanks
  }
  if (args.left.length > 0) {
    candidate.left = args.left
  }
  if (args.right.length > 0) {
    candidate.right = args.right
  }
  if (args.language !== null) {
    candidate.language = args.language
  }
  return candidate
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/cli.test.ts`
Expected: all tests pass, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add serve.ts test/cli.test.ts
git commit -m "feat: add pure arg parsing for the add-question subcommand"
```

---

### Task 3: `add-question` subcommand wiring

**Files:**
- Modify: `serve.ts` — import `addQuestion`, add `mainAddQuestion`, extend the entry dispatch
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `addQuestion` (Task 1), `parseAddQuestionArgs`/`buildQuestionCandidate` (Task 2), `fail`, `QuizError`, `JSON_INDENT` (all already in `serve.ts`)

- [ ] **Step 1: Write the failing tests**

Add a `const MISSING_ANSWER_RE = /missing answer/` to `test/cli.test.ts`'s regex-constant block, then add:

```ts
test('add-question subcommand appends a valid question and exits 0', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))
  const scaffolded = start(['scaffold', baseDir, 'rust-lifetimes', 'Rust Lifetimes', 'One sentence'])
  await scaffolded.exited
  const { dir } = JSON.parse(scaffolded.stdout())

  const s = start([
    'add-question',
    dir,
    '--id',
    'q1',
    '--type',
    'mcq',
    '--prompt',
    'Pick b',
    '--choice',
    'a:A',
    '--choice',
    'b:B',
    '--answer',
    'b',
    '--rationale',
    'b is right',
  ])
  expect(await s.exited).toBe(EXIT_OK)
  const result = JSON.parse(s.stdout())
  expect(result.questionCount).toBe(1)
  expect(result.added.id).toBe('q1')
  expect(JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf8')).questions).toHaveLength(1)
})

test('add-question subcommand exits 2 with validation errors and writes nothing', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))
  const scaffolded = start(['scaffold', baseDir, 'rust-lifetimes', 'Rust Lifetimes', 'One sentence'])
  await scaffolded.exited
  const { dir } = JSON.parse(scaffolded.stdout())

  const s = start([
    'add-question',
    dir,
    '--id',
    'q1',
    '--type',
    'mcq',
    '--prompt',
    'Pick b',
    '--choice',
    'a:A',
    '--choice',
    'b:B',
  ])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(MISSING_ANSWER_RE)
  expect(existsSync(join(dir, 'questions.json'))).toBe(false)
})

test('add-question subcommand exits 2 with a usage message when required flags are missing', async () => {
  const s = start(['add-question', mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(USAGE_RE)
})
```

- [ ] **Step 2: Run the tests, confirm they fail correctly**

Run: `npx vitest run test/cli.test.ts`
Expected: the first test fails because `add-question` isn't a recognized subcommand yet (it falls through to `main()`, which tries to load `dir` as a quiz directory and exits `2` with a "cannot read meta.json" error rather than `EXIT_OK`); the other two fail the same way with the wrong stderr content.

- [ ] **Step 3: Implement in `serve.ts`**

Change the `lib/quiz.ts` import:
```ts
import {
  answersPath,
  archiveAnswers,
  loadFull,
  QuizError,
  readAnswers,
  scaffoldQuiz,
} from './lib/quiz.ts'
```
to:
```ts
import {
  addQuestion,
  answersPath,
  archiveAnswers,
  loadFull,
  QuizError,
  readAnswers,
  scaffoldQuiz,
} from './lib/quiz.ts'
```

Add right after `mainScaffold`'s closing brace:
```ts
function mainAddQuestion(argv: string[]): void {
  const opts = parseAddQuestionArgs(argv)
  if (opts.dir === null || opts.id === null || opts.type === null || opts.prompt === null) {
    fail(ADD_QUESTION_USAGE)
  }

  const candidate = buildQuestionCandidate(opts)
  let questions: Question[]
  try {
    questions = addQuestion(opts.dir, candidate)
  } catch (err) {
    if (err instanceof QuizError) {
      fail(err.message, err.errors)
    }
    throw err
  }
  const added = questions.find((q) => q.id === opts.id)
  process.stdout.write(
    `${JSON.stringify({ ok: true, questionCount: questions.length, added }, null, JSON_INDENT)}\n`,
  )
}
```

Change the entry dispatch:
```ts
if (invokedDirectly()) {
  const [subcommand, ...rest] = process.argv.slice(2)
  if (subcommand === 'scaffold') {
    mainScaffold(rest)
  } else {
    main()
  }
}
```
to:
```ts
if (invokedDirectly()) {
  const [subcommand, ...rest] = process.argv.slice(2)
  if (subcommand === 'scaffold') {
    mainScaffold(rest)
  } else if (subcommand === 'add-question') {
    mainAddQuestion(rest)
  } else {
    main()
  }
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/cli.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add serve.ts test/cli.test.ts
git commit -m "feat: wire the add-question subcommand"
```

---

### Task 4: `buildReport` in `lib/report.ts`

**Files:**
- Modify: `lib/score.ts` — export the existing private `asStrings`/`asRecord` guards (no behavior change)
- Create: `lib/report.ts`
- Test: Create `test/report.test.ts`

**Interfaces:**
- Consumes: `CLOSED_TYPES`, `scoreQuestion`, `asStrings`, `asRecord` from `./score.ts`; `AnswerValue`, `Answers`, `Choice`, `Question` from `./types.ts`
- Produces: `export interface ReportEntry { id: string; type: Question['type']; prompt: string; result: 'correct' | 'incorrect' | 'needs_grading'; flagged: boolean; yourAnswer: string | string[] | Record<string, string> | null; referenceAnswer: string | string[] | Record<string, string>; rationale: string }`
- Produces: `export function buildReport(questions: Question[], answers: Answers): ReportEntry[]`

- [ ] **Step 1: Write the failing tests**

Create `test/report.test.ts`:

```ts
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { loadFull } from '../lib/quiz.ts'
import { buildReport } from '../lib/report.ts'
import type { Answers } from '../lib/types.ts'

const FIXTURE_DIR = fileURLToPath(new URL('../examples/all-types', import.meta.url))

function answersFor(responses: Answers['responses']): Answers {
  return {
    quizId: 'a3f9',
    status: 'submitted',
    startedAt: '2026-08-17T14:00:00.000Z',
    updatedAt: '2026-08-17T14:05:00.000Z',
    submittedAt: '2026-08-17T14:05:00.000Z',
    responses,
  }
}

test('buildReport resolves an mcq answer to its choice text, not its id', () => {
  const { questions } = loadFull(FIXTURE_DIR)
  const mcq = questions.find((q) => q.type === 'mcq')
  if (mcq?.type !== 'mcq') {
    throw new Error('fixture drifted')
  }
  const report = buildReport(
    questions,
    answersFor({ [mcq.id]: { value: mcq.answer, flagged: false } }),
  )
  const entry = report.find((e) => e.id === mcq.id)
  expect(entry?.result).toBe('correct')
  expect(entry?.referenceAnswer).toBe('O(n log n)')
  expect(entry?.yourAnswer).toBe('O(n log n)')
})

test('buildReport marks code questions as needs_grading with plain text', () => {
  const { questions } = loadFull(FIXTURE_DIR)
  const code = questions.find((q) => q.type === 'code')
  if (code?.type !== 'code') {
    throw new Error('fixture drifted')
  }
  const report = buildReport(
    questions,
    answersFor({ [code.id]: { value: 'my solution text', flagged: true } }),
  )
  const entry = report.find((e) => e.id === code.id)
  expect(entry?.result).toBe('needs_grading')
  expect(entry?.yourAnswer).toBe('my solution text')
  expect(entry?.referenceAnswer).toBe(code.answer)
  expect(entry?.flagged).toBe(true)
})

test('buildReport resolves blank answers to per-blank accepted text and raw user text', () => {
  const { questions } = loadFull(FIXTURE_DIR)
  const blank = questions.find((q) => q.type === 'blank')
  if (blank?.type !== 'blank') {
    throw new Error('fixture drifted')
  }
  const report = buildReport(
    questions,
    answersFor({ [blank.id]: { value: { '1': 'complete binary', '2': 'array' }, flagged: false } }),
  )
  const entry = report.find((e) => e.id === blank.id)
  expect(entry?.result).toBe('correct')
  expect(entry?.yourAnswer).toEqual({ '1': 'complete binary', '2': 'array' })
  expect(entry?.referenceAnswer).toEqual({ '1': 'complete', '2': 'array' })
})

test('buildReport resolves match pairs to left/right choice text', () => {
  const { questions } = loadFull(FIXTURE_DIR)
  const match = questions.find((q) => q.type === 'match')
  if (match?.type !== 'match') {
    throw new Error('fixture drifted')
  }
  const report = buildReport(
    questions,
    answersFor({ [match.id]: { value: { l1: 'r1', l2: 'r2', l3: 'r1' }, flagged: false } }),
  )
  const entry = report.find((e) => e.id === match.id)
  expect(entry?.result).toBe('incorrect')
  expect(entry?.referenceAnswer).toEqual({
    'peek max': 'O(1)',
    insert: 'O(log n)',
    'build heap from array': 'O(n)',
  })
  expect(entry?.yourAnswer).toEqual({
    'peek max': 'O(1)',
    insert: 'O(log n)',
    'build heap from array': 'O(1)',
  })
})

test('buildReport marks an unanswered closed question incorrect with a null yourAnswer', () => {
  const { questions } = loadFull(FIXTURE_DIR)
  const mcq = questions.find((q) => q.type === 'mcq')
  if (mcq === undefined) {
    throw new Error('fixture drifted')
  }
  const report = buildReport(questions, answersFor({}))
  const entry = report.find((e) => e.id === mcq.id)
  expect(entry?.result).toBe('incorrect')
  expect(entry?.yourAnswer).toBeNull()
})
```

- [ ] **Step 2: Run the tests, confirm they fail on the missing module**

Run: `npx vitest run test/report.test.ts`
Expected: fails to resolve `../lib/report.ts` (module not found) — not an assertion failure.

- [ ] **Step 3: Implement**

In `lib/score.ts`, change the final export line from:
```ts
export { CLOSED_TYPES, normalizeText, scoreQuestion, scoreQuiz }
```
to:
```ts
export { asRecord, asStrings, CLOSED_TYPES, normalizeText, scoreQuestion, scoreQuiz }
```

Create `lib/report.ts`:
```ts
import { asRecord, asStrings, CLOSED_TYPES, scoreQuestion } from './score.ts'
import type { AnswerValue, Answers, Choice, Question } from './types.ts'

export interface ReportEntry {
  id: string
  type: Question['type']
  prompt: string
  result: 'correct' | 'incorrect' | 'needs_grading'
  flagged: boolean
  yourAnswer: string | string[] | Record<string, string> | null
  referenceAnswer: string | string[] | Record<string, string>
  rationale: string
}

function choiceText(choices: Choice[], id: string): string {
  return choices.find((c) => c.id === id)?.text ?? id
}

// biome-ignore lint/style/useDefaultSwitchClause: exhaustive switch over the Question union by
// design, matching scoreQuestion's own style in score.ts -- a default would silently pass a
// future unhandled type through instead of failing tsc.
function resolveAnswers(
  question: Question,
  value: AnswerValue | null,
): { yourAnswer: ReportEntry['yourAnswer']; referenceAnswer: ReportEntry['referenceAnswer'] } {
  switch (question.type) {
    case 'mcq':
      return {
        referenceAnswer: choiceText(question.choices, question.answer),
        yourAnswer: typeof value === 'string' ? choiceText(question.choices, value) : null,
      }
    case 'multi':
      return {
        referenceAnswer: question.answer.map((id) => choiceText(question.choices, id)),
        yourAnswer:
          value === null ? null : asStrings(value).map((id) => choiceText(question.choices, id)),
      }
    case 'match': {
      const resolvePairs = (pairs: Record<string, string>): Record<string, string> =>
        Object.fromEntries(
          Object.entries(pairs).map(([l, r]) => [
            choiceText(question.left, l),
            choiceText(question.right, r),
          ]),
        )
      return {
        referenceAnswer: resolvePairs(question.answer),
        yourAnswer: value === null ? null : resolvePairs(asRecord(value)),
      }
    }
    case 'blank':
      return {
        referenceAnswer: Object.fromEntries(
          Object.entries(question.answer).map(([id, accept]) => [id, accept[0] ?? '']),
        ),
        yourAnswer: value === null ? null : asRecord(value),
      }
    case 'short':
    case 'code':
      return {
        referenceAnswer: question.answer,
        yourAnswer: typeof value === 'string' ? value : null,
      }
  }
}

export function buildReport(questions: Question[], answers: Answers): ReportEntry[] {
  return questions.map((question) => {
    const entry = answers.responses[question.id]
    const value = entry?.value ?? null
    const result: ReportEntry['result'] = CLOSED_TYPES.has(question.type)
      ? scoreQuestion(question, value)
        ? 'correct'
        : 'incorrect'
      : 'needs_grading'
    const { yourAnswer, referenceAnswer } = resolveAnswers(question, value)
    return {
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      result,
      flagged: entry?.flagged ?? false,
      yourAnswer,
      referenceAnswer,
      rationale: question.rationale,
    }
  })
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/report.test.ts test/score.test.ts`
Expected: all pass, including the pre-existing `score.test.ts` suite (the export-line change must not alter `scoreQuiz`/`scoreQuestion` behavior).

- [ ] **Step 5: Commit**

```bash
git add lib/score.ts lib/report.ts test/report.test.ts
git commit -m "feat: add buildReport, joining questions and answers with ids resolved to text"
```

---

### Task 5: `report` subcommand wiring

**Files:**
- Modify: `serve.ts` — import `buildReport`, add `REPORT_USAGE` and `mainReport`, extend the entry dispatch
- Test: `test/cli.test.ts`

**Interfaces:**
- Consumes: `buildReport` (Task 4), `loadFull`, `readAnswers`, `QuizError` (already imported in `serve.ts`)

- [ ] **Step 1: Write the failing tests**

Add to `test/cli.test.ts`:

```ts
test('report subcommand prints resolved entries after a submit', async () => {
  const dir = freshQuizDir()
  const s = start([dir])
  const base = await s.ready
  await fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ responses: { q1: { value: 'b', flagged: false } } }),
  })
  await fetch(`${base}/api/submit`, { method: 'POST' })
  await s.exited

  const r = start(['report', dir])
  expect(await r.exited).toBe(EXIT_OK)
  const payload = JSON.parse(r.stdout())
  expect(payload.status).toBe('submitted')
  const q1 = payload.entries.find((e: { id: string }) => e.id === 'q1')
  expect(q1.result).toBe('correct')
  expect(q1.yourAnswer).toBe('O(n log n)')
})

test('report subcommand exits 2 for a nonexistent quiz directory', async () => {
  const r = start(['report', '/nonexistent/quiz'])
  expect(await r.exited).toBe(EXIT_BAD_INPUT)
  expect(r.stderr()).toMatch(CANNOT_READ_RE)
})
```

- [ ] **Step 2: Run the tests, confirm they fail correctly**

Run: `npx vitest run test/cli.test.ts`
Expected: both fail because `report` isn't a recognized subcommand yet — the first falls through to `main()` and hangs/serves instead of exiting (it will time out; if so, that itself confirms the RED state — do not skip verifying this), the second fails the same way `main()` would on a bad path, which happens to already exit 2 for a different reason. Confirm by reading the actual failure output, not just the exit code.

- [ ] **Step 3: Implement in `serve.ts`**

Add `import { buildReport } from './lib/report.ts'` near the other local imports.

Add near `SCAFFOLD_USAGE`/`ADD_QUESTION_USAGE`:
```ts
const REPORT_USAGE = 'usage: serve.ts report <quiz-dir>'
```

Add right after `mainAddQuestion`'s closing brace:
```ts
function mainReport(argv: string[]): void {
  const [dir] = argv
  if (dir === undefined) {
    fail(REPORT_USAGE)
  }

  let loaded: { meta: Meta; questions: Question[] }
  try {
    loaded = loadFull(dir)
  } catch (err) {
    if (err instanceof QuizError) {
      fail(err.message, err.errors)
    }
    throw err
  }
  const questionIds = loaded.questions.map((q) => q.id)
  const answers = readAnswers(dir, loaded.meta.id, questionIds)
  const entries = buildReport(loaded.questions, answers)
  process.stdout.write(
    `${JSON.stringify({ title: loaded.meta.title, status: answers.status, entries }, null, JSON_INDENT)}\n`,
  )
}
```

Change the entry dispatch again:
```ts
if (invokedDirectly()) {
  const [subcommand, ...rest] = process.argv.slice(2)
  if (subcommand === 'scaffold') {
    mainScaffold(rest)
  } else if (subcommand === 'add-question') {
    mainAddQuestion(rest)
  } else if (subcommand === 'report') {
    mainReport(rest)
  } else {
    main()
  }
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run: `npx vitest run test/cli.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run the full check and rebuild**

```bash
npm run build
npm run check
```
Expected: `npm run build` reports success (regenerates `app/dist/` and `bin/any-quiz.mjs`); `npm run check` (lint, typecheck, every test file including `test/buildinfo.test.ts`) passes clean.

- [ ] **Step 6: Commit**

```bash
git add serve.ts test/cli.test.ts app/dist bin/any-quiz.mjs bin/.buildinfo.json app/dist/.buildinfo.json
git commit -m "feat: wire the report subcommand"
```

---

### Task 6: Wire both commands into all three `SKILL.md` adapters

**Files:**
- Modify: `skills/any-quiz/SKILL.md`
- Modify: `pi-skills/any-quiz/SKILL.md`
- Modify: `codex-skills/any-quiz/SKILL.md`

No tests — this is documentation, but it depends on Tasks 1–5 being real and correct, since it advertises exact flags and JSON shapes.

- [ ] **Step 1: Update the "### 3. Validate" step in each file**

Append this sentence to the existing paragraph that ends "...fix `questions.json` and check again before serving.":

> To fix or add just one question instead of rewriting the whole file, see `add-question` under Flags.

- [ ] **Step 2: Replace the "### 5. Coach" opening in each file**

Replace the paragraph and numbered step that currently read:

```markdown
`auto` covers only the four self-scoring types; `short` and `code` are listed in `needsGrading` and are yours to grade.

Then:

1. Read `questions.json` from `quizDir` — it holds the `answer` and `rationale` for every question.
2. Grade the `needsGrading` questions against their reference answers. Be generous about phrasing, strict about substance.
```

with (substituting the harness's own invocation prefix — `${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs` for `skills/any-quiz/SKILL.md`, `../../bin/any-quiz.mjs` for the other two):

```markdown
`auto` covers only the four self-scoring types; `short` and `code` are listed in `needsGrading` and are yours to grade. Don't cross-reference this against `questions.json` by hand — run:

```
node "${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs" report <quizDir>
```

It prints each question's `id`, `prompt`, `result` (`correct` / `incorrect` / `needs_grading`), `flagged`, `yourAnswer`, `referenceAnswer`, and `rationale` — already joined, with choice and match-pair ids already resolved to their text.

Then:

1. Grade the `needs_grading` entries against their `referenceAnswer`. Be generous about phrasing, strict about substance.
```

(The remaining numbered items — "Coach across all results..." and "Offer a follow-up quiz..." — keep their existing text; only their numbers shift down by one since item 1 was removed.)

- [ ] **Step 3: Extend the "## Flags" section in each file**

Replace:
```markdown
`scaffold`'s own flags: `--parent <id>` sets `parentQuizId`; repeatable `--target <id>` sets `targets`.
```
with:
```markdown
`scaffold`'s own flags: `--parent <id>` sets `parentQuizId`; repeatable `--target <id>` sets `targets`.

`add-question <quiz-dir>` appends one question to `questions.json`, validates the whole file against the same rules as above, and writes nothing if it fails:

| flag | question types | effect |
|---|---|---|
| `--id`, `--type`, `--prompt` | all | required on every call |
| `--rationale` | all | optional but expected |
| `--choice <id>:<text>` (repeatable, 2+) | `mcq`, `multi` | the choice list |
| `--answer <value>` (repeatable) | all | scalar for `mcq`/`short`/`code`; repeat for `multi` |
| `--blank <id>[:<hint>]` (repeatable) | `blank` | one per placeholder |
| `--accept <blankId>:<text>` (repeatable) | `blank` | one accepted synonym per call |
| `--left <id>:<text>`, `--right <id>:<text>` (repeatable, 2+ each) | `match` | the two lists |
| `--match <leftId>:<rightId>` (repeatable) | `match` | the answer pairing |
| `--language <lang>` | `code` | required for `code` |

`report <quiz-dir>` prints each question's `id`, `prompt`, `result`, `flagged`, `yourAnswer`, `referenceAnswer`, and `rationale` — the join described under step 5, replacing a manual read of `questions.json` during coaching.
```

- [ ] **Step 4: Verify**

Run: `npm run check`
Expected: passes (Markdown isn't linted by this repo's Biome config, but this confirms the doc edits didn't accidentally touch any tracked source file).

Read all three edited files back and confirm: the invocation prefix in each new code block matches that file's existing convention (`${CLAUDE_PLUGIN_ROOT}/...` only in `skills/any-quiz/SKILL.md`; `../../bin/any-quiz.mjs` in the other two), and the numbered "Then:" list in each file now starts at 1 with "Grade the `needs_grading` entries...".

- [ ] **Step 5: Commit**

```bash
git add skills/any-quiz/SKILL.md pi-skills/any-quiz/SKILL.md codex-skills/any-quiz/SKILL.md
git commit -m "docs: wire add-question and report into all three harness adapters"
```

---

## Self-Review

**Spec coverage:**
- "cli way to add a question... less tokens than json" → Tasks 1–3 (`addQuestion` + `add-question` subcommand, validated against the same schema, atomic write).
- "way to read a quiz results... token efficient" → Tasks 4–5 (`buildReport` + `report` subcommand, ids resolved to text, no raw schema noise).
- Making the features actually used (not dead code) → Task 6 (all three `SKILL.md` adapters).

**Placeholder scan:** every step above has real, complete code — no TBD/TODO, no "add appropriate handling," no "similar to Task N" without the code repeated in full.

**Type consistency:** `Record<string, unknown>` is the candidate type threaded from `buildQuestionCandidate` (Task 2) into `addQuestion` (Task 1); `AddQuestionArgs` field names (`choices`, `blanks`, `accepts`, `left`, `right`, `matches`, `answers`) are used identically in `parseAddQuestionArgs`, `deriveAnswer`, and `buildQuestionCandidate`; `ReportEntry` (Task 4) is constructed with exactly the fields `mainReport` (Task 5) serializes; `buildReport(questions: Question[], answers: Answers)` signature matches both its test call sites and its `mainReport` call site.
