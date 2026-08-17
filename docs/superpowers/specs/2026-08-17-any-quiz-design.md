# any-quiz — Design

**Date:** 2026-08-17
**Status:** Approved, ready for implementation planning

## Purpose

A Claude skill for ad-hoc interactive quizzes. Claude authors a quiz mid-conversation, the user takes it in a browser, and the responses flow back into the same session so Claude can grade the open-ended answers and coach the user through their mistakes.

The quiz is a shared workspace between user and Claude: Claude owns authoring and coaching, the browser owns answering, and a folder on disk is the contract between them.

## Success criteria

1. Claude can create and serve a quiz with no user setup beyond a symlink — no `npm install`, no build step, no config file.
2. The user clicks Done and coaching begins with no further prompting: no polling loop, no "tell me when you're finished".
3. The correct answers never reach the browser.
4. Deterministic question types are scored without model involvement.
5. The whole thing still runs in three years with no dependency maintenance.

## Non-goals

- Multi-user quizzes, accounts, or any network exposure beyond localhost.
- Persistent quiz history UI (browsing past quizzes in the browser). The folder listing is the history.
- Timers or exam-simulation pressure features.
- Publishing to npm or distributing outside this user's machine.

## Architecture

Three parts with narrow interfaces between them:

```
Claude session  ──writes──▶  quiz folder  ◀──reads/writes──  serve.js  ◀──HTTP──  browser
      ▲                                                          │
      └──────────────── stdout on exit ──────────────────────────┘
```

- **Claude** writes `meta.json` + `questions.json`, spawns the server as a background task, and later consumes the server's stdout.
- **serve.js** is a short-lived process bound to one quiz folder. It serves the browser, persists drafts, and terminates on submit.
- **The browser** is a static page. It knows nothing about the filesystem and never receives answer keys.

The process lifetime *is* the handshake. Claude does not poll; the harness re-invokes Claude when the background process exits.

### Repository layout

```
any-quiz/
  SKILL.md                  # the skill Claude reads
  README.md
  serve.js                  # entry point
  lib/
    quiz.js                 # load, validate, strip key, atomic write
    score.js                # deterministic scoring
    open.js                 # platform browser launch
  web/
    index.html
    app.js
    style.css
    types/
      mcq.js multi.js blank.js short.js code.js order.js match.js
  test/
    quiz.test.js
    score.test.js
    server.test.js
  examples/
    all-types/              # fixture quiz covering all 7 types
      meta.json
      questions.json
  docs/superpowers/specs/
```

Zero runtime dependencies. Node's built-in `http`, `fs`, `path`, `child_process`, and `node:test` only. No `package.json` dependencies section, no lockfile, no `node_modules`, no bundler.

### Installation

```
ln -s /Users/chrisarter/Documents/projects/any-quiz ~/.claude/skills/any-quiz
```

`SKILL.md` sits at the repo root, so the symlink makes the skill discoverable and the server script reachable at the same path.

## Data model

Each quiz is one folder:

```
~/.any-quiz/2026-08-17-rust-lifetimes-a3f9/
  meta.json
  questions.json
  answers.json      # created on first autosave
```

Folder name: `YYYY-MM-DD-<slug>-<id>`. `slug` is a kebab-case topic summary; `id` is 4 hex characters, enough to disambiguate same-day same-topic quizzes.

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

```json
{ "version": 1, "questions": [ ... ] }
```

Every question object carries `id`, `type`, `prompt`, `answer`, `rationale`. `rationale` is Claude's own note-to-self explaining why the answer is correct — it exists so grading survives context compaction or a fresh session opening an old quiz. Optional `points` defaults to 1.

Type-specific shapes:

| type | extra fields | `answer` shape |
|---|---|---|
| `mcq` | `choices: [{id, text}]` | choice id, e.g. `"b"` |
| `multi` | `choices: [{id, text}]` | array of choice ids, e.g. `["a","c"]` |
| `blank` | prompt contains `{{1}}`, `{{2}}`; `blanks: [{id, hint}]` | object of accept-lists: `{"1": ["heap", "binary heap"]}` |
| `short` | — | reference prose answer |
| `code` | `language` | reference solution |
| `order` | `items: [{id, text}]` | array of item ids in correct order |
| `match` | `left: [{id,text}]`, `right: [{id,text}]` | object mapping left id to right id |

`blank` accept-lists are compared case-insensitively with surrounding whitespace trimmed. All other exact-match comparisons are literal.

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

`status` is `"draft"` until submit, then `"submitted"` with `submittedAt` set. `value` is `null` for unanswered. `value` shape mirrors the type's `answer` shape, except `blank`, whose value is an object of raw strings rather than accept-lists.

`flagged` is a per-question "not sure" toggle. It is the more useful coaching signal than correctness alone: a flagged-but-correct answer is a guess worth reinforcing, and an unflagged-but-wrong answer is a confident misconception worth attacking.

## Server

```
node serve.js <quiz-dir> [--port N] [--no-open] [--retake]
```

Binds `127.0.0.1` only. Default port is ephemeral (`0`); `--port` pins one. Never binds a public interface.

### Routes

| route | behavior |
|---|---|
| `GET /` | `web/index.html` |
| `GET /app.js`, `/style.css`, `/types/*.js` | static from `web/`, path-normalized, traversal rejected |
| `GET /api/quiz` | `{ meta, questions }` with `answer` and `rationale` removed |
| `GET /api/answers` | current `answers.json`, or a fresh skeleton if none exists |
| `PUT /api/answers` | persist draft, atomic write, respond `204` |
| `POST /api/submit` | set `status: "submitted"`, write, respond `200`, print result to stdout, close listener, exit `0` |

### Answer-key stripping

`lib/quiz.js` exposes two loaders: `loadFull(dir)` returns questions with the key intact (server-side scoring, Claude's own reads) and `loadPublic(dir)` returns questions with `answer` and `rationale` deleted. The `/api/quiz` handler calls `loadPublic` and has no access to a full question object at all.

Stripping in the load path rather than the serialization path means a future handler cannot accidentally leak the key by serializing the wrong object.

### Atomic writes

Every write to `answers.json` goes to `answers.json.tmp` in the same directory, then `fs.renameSync` over the target. A crash mid-write leaves the previous good file intact rather than a truncated one.

### Browser launch

`lib/open.js` shells out to `open` on darwin, `xdg-open` on linux, `start` on win32. Failure to launch is non-fatal: the URL is already on stdout, so the server logs a line and keeps serving.

### Exit codes

| code | meaning |
|---|---|
| `0` | submitted successfully; result JSON on stdout |
| `2` | `questions.json` missing or invalid; validation errors on stderr |
| `3` | abandoned — SIGINT/SIGTERM received; draft flushed to disk first |

### Retake guard

If `answers.json` already has `status: "submitted"`, the server refuses to start and exits `2` with a message, unless `--retake` is passed. `--retake` archives the existing file to `answers-<submittedAt>.json`, with the timestamp compacted to `YYYYMMDDTHHMMSSZ` so it is filename-safe, then starts fresh. This prevents a re-served quiz from silently overwriting a completed attempt.

### Port conflict

If `--port` is given and the port is in use, the server logs a warning and falls back to an ephemeral port rather than failing. The URL is printed either way, so the fallback is transparent.

## Deterministic pre-scoring

`lib/score.js` scores the five closed types — `mcq`, `multi`, `blank`, `order`, `match` — by exact comparison before the server exits. `short` and `code` are left ungraded and listed in `needsGrading`.

Doing this in code rather than in the model means closed-question scoring is deterministic, costs no tokens, and cannot be gotten wrong by arithmetic slip.

stdout on successful submit:

```json
{
  "quizId": "a3f9",
  "quizDir": "/Users/chrisarter/.any-quiz/2026-08-17-rust-lifetimes-a3f9",
  "auto": {
    "correct": 4,
    "total": 5,
    "perQuestion": { "q1": true, "q2": false, "q3": true, "q5": true, "q7": true }
  },
  "needsGrading": ["q4", "q6"],
  "flagged": ["q3"],
  "responses": { "...": "full answers.json responses object" }
}
```

`auto.total` counts only closed-type questions. `perQuestion` omits open types entirely.

## Frontend

A single scrollable page listing every question, not a one-question-at-a-time wizard. The user can skim ahead, jump back, and see scope at a glance — which matters for an ad-hoc quiz whose length they did not choose.

`app.js` fetches `/api/quiz` and `/api/answers`, then for each question calls the matching type module. Each module in `web/types/` exports:

```js
export function render(question, value, onChange) // -> Node
```

Roughly 40 lines each, no shared state, no framework. `app.js` owns all state and persistence; type modules are pure render-plus-callback.

**Sticky footer:** progress (`6/10 answered · 1 flagged`) and the Done button. Done warns via `confirm()` if any question is unanswered, but does not block — an unanswered question is itself information worth coaching on.

**Autosave:** `onChange` marks state dirty; a 500ms debounced `PUT /api/answers` persists it. The response is ignored; failures retry on the next change.

**Flagging:** every question renders a small "not sure" toggle beside its number.

**`order` accessibility:** HTML5 drag-and-drop for mouse, plus ↑/↓ buttons on each item so the type is fully usable from the keyboard.

**Post-submit:** the page replaces itself with "Answers sent back to Claude — you can close this tab." No score is shown; the coaching conversation is the feedback channel, and showing a score here would front-run it.

## Session flow

Documented in `SKILL.md` as the procedure Claude follows:

1. Claude picks a slug and id, creates `~/.any-quiz/<date>-<slug>-<id>/`, writes `meta.json` and `questions.json`.
2. Claude runs `node ~/.claude/skills/any-quiz/serve.js <dir>` with `run_in_background: true`.
3. Claude reports the URL and stops — no polling, no follow-up questions while the user is answering.
4. User answers and clicks Done. The server writes, prints, and exits. The harness re-invokes Claude with the stdout payload.
5. Claude reads `questions.json` with `loadFull` semantics (it has the key and rationales), grades the `needsGrading` questions, and coaches across all results — weighting confidently-wrong answers over flagged ones.
6. Claude offers a follow-up quiz whose `meta.json` sets `parentQuizId` to this quiz and `targets` to the missed question ids.

If the server exits `3` (abandoned), Claude says so and offers to re-serve the same folder — the draft is intact.

## Error handling

| situation | behavior |
|---|---|
| `questions.json` malformed or fails schema | exit `2`, per-question validation errors on stderr, nothing served |
| quiz dir does not exist | exit `2` with the path echoed |
| already submitted, no `--retake` | exit `2` with a message naming the `--retake` flag |
| pinned port busy | warn, fall back to ephemeral |
| browser launch fails | warn, keep serving; URL is already on stdout |
| tab closed without submitting | draft persists; server keeps running. Claude stops the background task to end it, which arrives as SIGTERM |
| SIGINT / SIGTERM | flush draft, exit `3` |
| `PUT /api/answers` with unknown question id | `400`, draft unchanged |

## Testing

`node:test`, no test dependencies. `examples/all-types/` is both the documentation fixture and the test fixture.

**`test/quiz.test.js`** — validation accepts the all-types fixture and rejects each malformed variant (missing `answer`, unknown `type`, duplicate question ids, `blank` prompt whose `{{n}}` placeholders do not match its `blanks` array); `loadPublic` output contains no `answer` or `rationale` key at any depth; atomic write leaves the original intact when the write throws mid-way.

**`test/score.test.js`** — each closed type scored right and wrong; `blank` accept-list matching is case- and whitespace-insensitive; `multi` and `order` are order-sensitive where they should be (`multi` is not, `order` is); open types never appear in `perQuestion`.

**`test/server.test.js`** — boot on an ephemeral port against a temp copy of the fixture; assert `GET /api/quiz` response body contains neither `"answer"` nor `"rationale"`; `PUT /api/answers` then `GET /api/answers` round-trips; `POST /api/submit` yields exit code `0` and stdout matching the documented shape; static route rejects `../` traversal; second boot against the submitted folder exits `2` without `--retake` and succeeds with it.

## Open questions

None. All decisions resolved during brainstorming.
