# any-quiz — Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation planning

## Purpose

A Claude skill for ad-hoc interactive quizzes. Claude authors a quiz mid-conversation, the user takes it in a browser, and the responses flow back into the same session so Claude can grade the open-ended answers and coach the user through their mistakes.

The quiz is a shared workspace between user and Claude: Claude owns authoring and coaching, the browser owns answering, and a folder on disk is the contract between them.

## Success criteria

1. Claude can create and serve a quiz with no user setup beyond a symlink — no `npm install`, no build, no config.
2. The user clicks Done and coaching begins with no further prompting: no polling loop, no "tell me when you're finished".
3. The correct answers never reach the browser.
4. Deterministic question types are scored without model involvement.
5. Contributors get a conventional toolchain: TypeScript strict, a real component test for every question type, and one command that lints, type-checks, and tests.

## Non-goals

- Multi-user quizzes, accounts, or any network exposure beyond localhost.
- Server-side rendering. One user on `127.0.0.1` with no SEO, no crawler, and no cold cache — SSR would buy nothing and would take process lifetime away from `serve.ts`, which is where the submit handshake lives.
- Persistent quiz history UI. The folder listing is the history.
- Timers or exam-simulation pressure features.
- Publishing to npm.

## Tech stack

| Concern | Choice | Version |
|---|---|---|
| Language | TypeScript, `strict` | `^7.0.2` (bin: `tsc`) |
| Server runtime | Node built-ins, run directly via native type stripping | `>=22.18` |
| Frontend | React SPA | `^19.2.8` |
| Bundler | Vite (build-time only) | `^8.2.1` |
| Tests | Vitest, two projects (node + jsdom) | `^4.1.10` |
| Component tests | Testing Library + user-event | `^16.3.2` / `^14.6.4` |
| Lint + format | Biome, `preset: "all"` | `^2.5.8` |

**Runtime dependencies: zero.** Everything above is a `devDependency`. The shipped skill is `serve.ts`, `lib/*.ts`, and the committed `app/dist/` bundle.

### Why the server needs no build

Node 22.18+ strips TypeScript types natively, so `node serve.ts <dir>` just runs. `tsconfig.json` sets `erasableSyntaxOnly: true` so the type checker rejects the syntax type stripping cannot erase (enums, namespaces, parameter properties) rather than letting it fail at runtime. Relative imports carry explicit `.ts` / `.tsx` extensions everywhere, which is what native stripping requires and what Vite and Vitest both accept.

### Why `app/dist/` is committed

Browsers cannot run TypeScript or JSX, so the frontend must be built. Committing the build output preserves the install story — symlink and it runs, with no `npm install` for the user. `npm install` is a contributor step only.

Two measures keep a committed build from rotting:

- **Stable filenames, quiet diffs.** Content hashes in filenames are pointless when the server sends `cache-control: no-store`, so they are disabled. `.gitattributes` marks `app/dist/** -diff linguist-generated=true`.
- **A staleness guard.** `npm run build` writes `app/dist/.buildinfo.json` containing a SHA-256 over the sorted contents of every frontend source file. A Vitest test recomputes that hash and fails when it diverges, and `serve.ts` prints a stderr warning when it detects a stale bundle. Forgetting to rebuild becomes a red test rather than a silently stale UI.

## Architecture

Three parts with narrow interfaces between them:

```
Claude session  ──writes──▶  quiz folder  ◀──reads/writes──  serve.ts  ◀──HTTP──  browser
      ▲                                                          │
      └──────────────── stdout on exit ──────────────────────────┘
```

- **Claude** writes `meta.json` + `questions.json`, spawns the server as a background task, and later consumes the server's stdout.
- **serve.ts** is a short-lived process bound to one quiz folder. It serves the built React app, persists drafts, and terminates on submit.
- **The browser** is a static SPA. It knows nothing about the filesystem and never receives answer keys.

The process lifetime *is* the handshake. Claude does not poll; the harness re-invokes Claude when the background process exits. This is why the bundler stays build-time only — `serve.ts` must keep owning the process.

### Repository layout

```
any-quiz/
  SKILL.md                  # the skill Claude reads
  README.md
  package.json              # zero dependencies, devDependencies only
  tsconfig.json             # strict, erasableSyntaxOnly
  biome.json                # preset "all"
  vite.config.ts            # build + Vitest projects
  .gitattributes
  serve.ts                  # CLI entry, run directly by Node
  lib/
    types.ts                # Question union, Answers, ResultPayload
    quiz.ts                 # validate, load full vs public, answers IO
    score.ts                # deterministic scoring
    server.ts               # createServer, all HTTP routing
    open.ts                 # platform browser launch
    buildinfo.ts            # source hash for the staleness guard
  app/
    index.html              # Vite root
    main.tsx
    Quiz.tsx
    useQuiz.ts              # state, autosave, submit
    style.css
    lib/
      blanks.ts             # parseBlanks
      progress.ts           # isAnswered, summarize
    questions/
      Mcq.tsx Multi.tsx Blank.tsx Short.tsx Code.tsx Order.tsx Match.tsx
      registry.ts           # type -> component
      *.test.tsx            # one component test file per type
    dist/                   # COMMITTED build output
  test/                     # node-environment tests
  tools/
    stamp-build.ts          # writes app/dist/.buildinfo.json
  examples/all-types/       # fixture quiz covering all 7 types
  docs/superpowers/
```

### Scripts

| script | does |
|---|---|
| `npm run build` | `vite build` then `tools/stamp-build.ts` |
| `npm test` | `vitest run` (both projects) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `biome check .` |
| `npm run format` | `biome check --write .` |
| `npm run check` | lint, typecheck, test — the one command before committing |
| `npm run dev:api` | `node serve.ts examples/all-types --port 4711 --no-open --retake` |
| `npm run dev:web` | `vite` (dev server, proxies `/api` to 4711) |

Two terminals for dev rather than a process-runner dependency.

### Installation

```
ln -s /Users/chrisarter/Documents/projects/any-quiz ~/.claude/skills/any-quiz
```

`SKILL.md` sits at the repo root, so the symlink makes the skill discoverable and `serve.ts` reachable at the same path.

## Type model

`lib/types.ts` is the single source of truth, imported by both `lib/` and `app/`. `Question` is a discriminated union on `type`, so a component that handles `mcq` cannot read `q.items` and the compiler enforces exhaustive handling in the registry and the scorer.

```ts
export interface Choice { id: string; text: string }

interface Base { id: string; prompt: string; rationale: string; points?: number }

export type Question =
  | (Base & { type: 'mcq';   choices: Choice[]; answer: string })
  | (Base & { type: 'multi'; choices: Choice[]; answer: string[] })
  | (Base & { type: 'blank'; blanks: { id: string; hint?: string }[]; answer: Record<string, string[]> })
  | (Base & { type: 'short'; answer: string })
  | (Base & { type: 'code';  language: string; answer: string })
  | (Base & { type: 'order'; items: Choice[]; answer: string[] })
  | (Base & { type: 'match'; left: Choice[]; right: Choice[]; answer: Record<string, string> })

export type QuestionType = Question['type']

// Distributes over the union so each member is stripped individually and
// keeps its own discriminant. A mapped type cannot iterate a union of objects.
type Strip<T> = T extends unknown ? Omit<T, 'answer' | 'rationale'> : never
export type PublicQuestion = Strip<Question>

export type AnswerValue = string | string[] | Record<string, string> | null
```

`PublicQuestion` is `Question` with the key removed — the type the browser sees. Because it is derived rather than hand-written, a new field on `Question` cannot drift out of it, and a component typed against `PublicQuestion` cannot compile if it reads `answer`.

Static types do not validate untrusted input, and `questions.json` is written by a model. `validateQuestions` remains a runtime check and returns a type predicate, so parsing and typing agree.

## Data model

Each quiz is one folder:

```
~/.any-quiz/2026-08-17-rust-lifetimes-a3f9/
  meta.json
  questions.json
  answers.json      # created on first autosave
```

Folder name: `YYYY-MM-DD-<slug>-<id>`. `slug` is a kebab-case topic summary; `id` is 4 hex characters.

### meta.json

```json
{
  "id": "a3f9",
  "slug": "rust-lifetimes",
  "title": "Rust Lifetimes & Borrowing",
  "topic": "Ownership, borrow checker, and lifetime elision in Rust",
  "createdAt": "2026-08-17T14:02:11Z",
  "parentQuizId": null,
  "targets": []
}
```

`parentQuizId` and `targets` support the follow-up flow: a quiz generated to drill previously-missed material points back at its parent and lists the parent question ids it targets.

### questions.json

`{ "version": 1, "questions": Question[] }`

`rationale` is Claude's note-to-self explaining why the answer is correct. It exists so grading survives context compaction or a fresh session opening an old quiz.

| type | extra fields | `answer` shape |
|---|---|---|
| `mcq` | `choices: Choice[]` | choice id, e.g. `"b"` |
| `multi` | `choices: Choice[]` | array of choice ids |
| `blank` | prompt contains `{{1}}`, `{{2}}`; `blanks: {id, hint}[]` | accept-lists: `{"1": ["heap", "binary heap"]}` |
| `short` | — | reference prose answer |
| `code` | `language` | reference solution |
| `order` | `items: Choice[]` | item ids in correct order |
| `match` | `left: Choice[]`, `right: Choice[]` | `{"l1": "r3"}` |

`blank` accept-lists are compared with case folded, surrounding whitespace trimmed, and internal whitespace collapsed. All other comparisons are literal.

### answers.json

```json
{
  "quizId": "a3f9",
  "status": "draft",
  "startedAt": "2026-08-17T14:05:02Z",
  "updatedAt": "2026-08-17T14:11:48Z",
  "submittedAt": null,
  "responses": {
    "q1": { "value": "b", "flagged": false },
    "q2": { "value": null, "flagged": true }
  }
}
```

`value` mirrors the type's `answer` shape, except `blank`, whose value is `Record<string, string>` of raw input rather than accept-lists.

`flagged` is a per-question "not sure" toggle. It is a more useful coaching signal than correctness alone: a flagged-but-correct answer is a guess worth reinforcing, and an unflagged-but-wrong answer is a confident misconception worth attacking.

## Server

```
node serve.ts <quiz-dir> [--port N] [--no-open] [--retake]
```

Binds `127.0.0.1` only. Default port is ephemeral (`0`); `--port` pins one. Never binds a public interface.

### Routes

| route | behavior |
|---|---|
| `GET /` | `app/dist/index.html` |
| `GET /assets/*` | static from `app/dist/`, path-normalized, traversal rejected |
| `GET /api/quiz` | `{ meta, questions }` as `PublicQuestion[]` — `answer` and `rationale` removed |
| `GET /api/answers` | current `answers.json`, or a fresh skeleton if none exists |
| `PUT /api/answers` | persist draft, atomic write, respond `204` |
| `POST /api/submit` | set `status: "submitted"`, write, respond `200`, emit result, exit `0` |

`POST /api/submit` returns `409` if the quiz is already submitted, which covers a stale tab re-posting.

### Answer-key stripping

`lib/quiz.ts` exposes `loadFull(dir)` returning `Question[]` and `loadPublic(dir)` returning `PublicQuestion[]` with `answer` and `rationale` deleted. The `/api/quiz` handler calls `loadPublic` and never holds a full question object.

Stripping in the load path rather than the serialization path means a future handler cannot leak the key by serializing the wrong object, and `PublicQuestion` makes that a compile error rather than a runtime one.

### Atomic writes

Every write to `answers.json` goes to `answers.json.tmp` in the same directory, then `renameSync` over the target. A crash mid-write leaves the previous good file intact rather than a truncated one.

### Browser launch

`lib/open.ts` shells out to `open` on darwin, `xdg-open` on linux, `start` on win32. Failure is non-fatal: the URL is already on stderr, so the server logs a line and keeps serving.

### stdout is a machine channel

Only the final result JSON goes to stdout. The URL banner, warnings, and validation errors all go to stderr, so Claude can parse stdout without stripping prose.

### Exit codes

| code | meaning |
|---|---|
| `0` | submitted; result JSON on stdout |
| `2` | invalid input or refused start; errors on stderr |
| `3` | abandoned — SIGINT/SIGTERM; draft flushed first |

### Retake guard

If `answers.json` already has `status: "submitted"`, the server exits `2` unless `--retake` is passed. `--retake` archives the file to `answers-<YYYYMMDDTHHMMSSZ>.json` and starts fresh, so re-serving cannot silently overwrite a completed attempt.

### Port conflict

If `--port` is given and busy, the server warns and falls back to an ephemeral port rather than failing. The URL is printed either way.

## Deterministic pre-scoring

`lib/score.ts` scores the five closed types — `mcq`, `multi`, `blank`, `order`, `match` — by exact comparison before the server exits. `short` and `code` are listed in `needsGrading` for Claude.

Scoring in code rather than in the model makes closed-question results deterministic, free, and immune to arithmetic slips. The scorer switches exhaustively over the `Question` union, so adding a type without scoring it is a compile error.

stdout on successful submit:

```json
{
  "quizId": "a3f9",
  "quizDir": "/Users/chrisarter/.any-quiz/2026-08-17-rust-lifetimes-a3f9",
  "auto": {
    "correct": 4,
    "total": 5,
    "perQuestion": { "q1": true, "q2": false, "q3": true, "q6": true, "q7": true }
  },
  "needsGrading": ["q4", "q5"],
  "flagged": ["q3"],
  "responses": { "...": "the full answers.json responses object" }
}
```

`auto.total` counts closed-type questions only; `perQuestion` omits open types.

## Frontend

A single scrollable page listing every question, not a one-question-at-a-time wizard. The user can skim ahead, jump back, and see scope at a glance — which matters for an ad-hoc quiz whose length they did not choose. One screen means no router.

`useQuiz.ts` owns all state and persistence: it fetches `/api/quiz` and `/api/answers`, exposes `setValue`, `toggleFlag`, and `submit`, and debounces a `PUT /api/answers` 500ms after each change. Question components are presentational — they receive a value and an `onChange` and touch neither the network nor global state, which is exactly what makes them unit-testable.

Shared props contract:

```ts
export interface QuestionProps<Q extends PublicQuestion, V> {
  question: Q
  value: V | null
  onChange: (value: V) => void
}
```

`questions/registry.ts` maps `QuestionType` to component and is typed so a missing entry fails the build.

**Sticky footer:** progress (`6/10 answered · 1 flagged`) and Done. Done warns via `confirm()` when questions are unanswered but does not block — an unanswered question is itself worth coaching on.

**Flagging:** every question renders a "not sure" toggle beside its number.

**`order` accessibility:** HTML5 drag-and-drop for mouse, plus ↑/↓ buttons on each item so the type is fully usable from the keyboard.

**Post-submit:** the page swaps to "Answers sent back to Claude — you can close this tab." No score is shown; the coaching conversation is the feedback channel, and a score here would front-run it.

## Testing

Vitest with two projects in `vite.config.ts`:

- **`node`** — `test/**/*.test.ts`, `environment: 'node'`. Validation, key stripping, atomic writes, scoring, HTTP routes, CLI exit codes, build freshness.
- **`browser`** — `app/**/*.test.tsx`, `environment: 'jsdom'`. One component test file per question type.

**Every question type gets a component test** driving real user interaction through `user-event` and asserting the exact `onChange` payload — clicking a radio yields the choice id, checking two boxes yields choice-order-stable ids, typing in a blank yields the right record, dragging and arrow-keying `order` yields the right sequence, and each component renders the value it is given. These are the tests that catch a renderer wired to the wrong field, which type-checking alone cannot.

Pure logic that does not need a DOM — `parseBlanks`, `isAnswered`, `summarize` — lives in `app/lib/` and is tested in the node project.

`examples/all-types/` is both the documentation fixture and the test fixture for every suite.

## Linting

`biome.json` uses the strongest floor Biome offers, then relaxes only what genuinely fights this codebase:

```json
{
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "all",
      "nursery": { "preset": "recommended" }
    }
  }
}
```

`preset: "all"` enables every stable rule across correctness, suspicious, complexity, style, performance, and a11y — the a11y group matters here because the whole UI is form controls. Nursery is held at `recommended` so unstable rules cannot break the build on a Biome upgrade. Any further exemption must be a named rule with a comment explaining it, never a group-wide `off`.

Biome also formats, so there is no separate formatter.

## Error handling

| situation | behavior |
|---|---|
| `questions.json` malformed or fails validation | exit `2`, per-question errors on stderr, nothing served |
| quiz dir does not exist | exit `2` with the path echoed |
| already submitted, no `--retake` | exit `2` naming the `--retake` flag |
| `app/dist/` missing | exit `2` telling the user to run `npm run build` |
| `app/dist/` stale | serve anyway, warn on stderr |
| pinned port busy | warn, fall back to ephemeral |
| browser launch fails | warn, keep serving |
| tab closed without submitting | draft persists; server runs until stopped |
| SIGINT / SIGTERM | flush draft, exit `3` |
| `PUT /api/answers` with unknown question id | `400`, draft unchanged |

## Session flow

Documented in `SKILL.md` as the procedure Claude follows:

1. Claude picks a slug and id, creates `~/.any-quiz/<date>-<slug>-<id>/`, writes `meta.json` and `questions.json`.
2. Claude runs `node ~/.claude/skills/any-quiz/serve.ts <dir>` with `run_in_background: true`.
3. Claude reports the URL and stops — no polling, no follow-up questions while the user is answering.
4. User answers and clicks Done. The server writes, prints, and exits. The harness re-invokes Claude with the stdout payload.
5. Claude reads `questions.json` (it has the key and rationales), grades the `needsGrading` questions, and coaches across all results — weighting confidently-wrong answers above flagged ones.
6. Claude offers a follow-up quiz whose `meta.json` sets `parentQuizId` and `targets`.

Exit `3` means the user closed it without submitting. Claude says so and offers to re-serve the same folder — the draft is intact.

## Open questions

None. All decisions resolved during brainstorming.
