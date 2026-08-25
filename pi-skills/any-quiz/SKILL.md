---
name: any-quiz
description: Use when the user wants to be quizzed, tested, drilled, or have their understanding checked on a topic — or asks to "quiz me", "test me on this", "make me a quiz", or wants to verify they actually learned something just discussed.
---

# any-quiz

Author a quiz, serve it in the browser, coach the user through the results.

## Procedure

### 1. Create the quiz folder

Pick a kebab-case `slug` for the topic, then scaffold the folder — this fills in the mechanical fields (`id`, `createdAt`, the folder path) so you only supply the content. From this skill's directory:

```
node ../../bin/any-quiz.mjs scaffold ~/.any-quiz <slug> "<title>" "<topic>"
```

It prints `{ dir, meta }`; `dir` is the quiz folder for the rest of this procedure. For a follow-up quiz, add `--parent <id>` and repeat `--target <id>` for each missed question instead of hand-writing `meta.json`. A bad slug (not kebab-case) exits `2` with the reason on stderr.

### 2. Write the questions

Write `questions.json` in `dir` — schema below. Aim for 5–10 questions unless the user asks otherwise. Mix types; do not make every question multiple choice.

### 3. Validate

```
node ../../bin/any-quiz.mjs <dir> --check
```

Exit `0` prints `{ ok, title, questionCount }` — the schema is good. Exit `2` prints the specific validation errors on stderr; fix `questions.json` and check again before serving.

### 4. Serve it

Pi has no background bash, so the command below blocks until the quiz is submitted or the tab is closed — pick a port up front and report the URL *before* running it, since that is the only chance to say anything until it returns:

`Quiz up: http://127.0.0.1:<port> — <question-count> questions.`

Then, from this skill's directory:

```
node ../../bin/any-quiz.mjs <quiz-dir> --port <port>
```

The browser opens automatically. Do not mention topics, entities, or anything else drawn from the questions themselves — you wrote the answer key, and anything you quote from memory risks being one. Then wait for the call to return; do not run it detached or poll for it, the call itself is the wait.

### 5. Coach

When the command returns, you receive its stdout:

```json
{
  "quizId": "a3f9",
  "quizDir": "/Users/you/.any-quiz/2026-08-17-rust-lifetimes-a3f9",
  "auto": { "correct": 4, "total": 5, "perQuestion": { "q1": true, "q2": false } },
  "needsGrading": ["q4", "q6"],
  "flagged": ["q3"],
  "responses": { "q1": { "value": "b", "flagged": false } }
}
```

`auto` covers only the four self-scoring types; `short` and `code` are listed in `needsGrading` and are yours to grade.

Then:

1. Read `questions.json` from `quizDir` — it holds the `answer` and `rationale` for every question.
2. Grade the `needsGrading` questions against their reference answers. Be generous about phrasing, strict about substance.
3. Coach across all results, weighting by signal rather than correctness alone:
   - **wrong and not flagged** — a confident misconception. Lead here; it is the most valuable thing on the page.
   - **wrong and flagged** — they knew they were guessing. Teach the concept plainly.
   - **right and flagged** — a lucky guess or shaky instinct. Confirm *why* it was right so it sticks.
   - **right and not flagged** — acknowledge briefly and move on. Do not pad.
4. Offer a follow-up quiz targeting what they missed.

Exit code `3` means they closed it without submitting. Say so and offer to re-serve the same folder — the draft is intact.

### Formatting the report

Open with a one-line score: `**4/5 auto-scored** · 2 flagged · 1 needs grading`. Follow it with a compact table so the whole result is scannable before any prose:

| # | Question | Result |
|---|---|---|
| 1 | Shape of a linked list node | ✅ |
| 2 | Big-O of a hash lookup | ❌ flagged |
| 3 | Explain amortized analysis | 🕐 grading |

Then coach in prose, grouped by the signal tiers above — confident misconceptions first, quiet correct answers last — using a short header per question (`**Q2 — Big-O of a hash lookup**`) rather than a wall of paragraphs. Skip a tier entirely if nothing landed there; don't write "nothing to report here." Close with the follow-up offer as its own line, not folded into the last question's coaching.

### 6. Follow-up quizzes

Same procedure, scaffolding with `--parent <previous id>` and `--target <id>` for each missed question.

## Flash card sets

Use this instead of a one-shot quiz when the user wants to drill material repeatedly in one sitting — "make me a flash card set on X", "let me drill X", "quiz me on X until I get it." A set restricts questions to the four self-scoring types (`mcq`/`multi`/`blank`/`match` — no `short`/`code`, since a set never grades through you) and can be run as many times as the user wants before they're done.

### Author it

Same as step 1, with `--kind set`:

```
node ../../bin/any-quiz.mjs scaffold ~/.any-quiz <slug> "<title>" "<topic>" --kind set
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

## Question schema

`questions.json` is `{"version": 1, "questions": [...]}`. Every question needs `id`, `type`, `prompt`, and `answer`; add `rationale` as well, because coaching reads it.

`rationale` is your note to yourself explaining why the answer is correct. Write it as if a future session with no memory of this conversation will grade the quiz — because that can happen.

| type | extra fields | `answer` | scored by |
|---|---|---|---|
| `mcq` | `choices: [{id, text}]` (2+) | choice id: `"b"` | the server |
| `multi` | `choices: [{id, text}]` (2+) | choice ids: `["a", "c"]` | the server, as a set |
| `blank` | prompt has `{{id}}` placeholders; `blanks: [{id, hint?}]` | accept-lists: `{"shape": ["complete", "complete binary"]}` | the server |
| `short` | — | reference prose answer | you |
| `code` | `language` | reference solution | you |
| `match` | `left: [{id,text}]`, `right: [{id,text}]` (2+ each) | `{"l1": "r3"}` | the server |

Rules the validator enforces — a violation exits `2` and serves nothing:

- Question ids must be unique, and every question needs a non-empty `prompt` and an `answer`.
- `blank` prompt placeholders must exactly match the `blanks` array ids, and `answer` keys must too. Placeholder ids are word characters: `{{1}}` and `{{shape}}` are both fine.
- Every `blank` accept-list must be a non-empty array of strings. List real synonyms; matching folds case, trims, and collapses whitespace, but is otherwise exact.
- `match` `answer` keys must be exactly the left ids, and every value must be a right id.

`hint` is optional on a blank; when present it becomes the input's placeholder text, so make it a nudge rather than the answer.

`mcq` and `multi` choices render in written order, so vary where the correct answer sits.

## Flags

| flag | effect |
|---|---|
| `--retake` | required to re-serve an already-submitted quiz; archives the previous attempt |
| `--port N` | pin a port (falls back to an ephemeral one if busy) |
| `--no-open` | do not launch a browser |
| `--check` | validate `questions.json` and exit, instead of serving |

`scaffold`'s own flags: `--parent <id>` sets `parentQuizId`; repeatable `--target <id>` sets `targets`; `--kind set` marks the folder a flash card set (omit for a normal quiz).

## Exit codes

`0` submitted (quiz) or finished with ≥1 run (set) · `2` invalid quiz or refused start · `3` abandoned (quiz) or closed with zero runs completed (set)
