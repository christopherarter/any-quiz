---
name: any-quiz
description: Use when the user wants to be quizzed, tested, drilled, or have their understanding checked on a topic — or asks to "quiz me", "test me on this", "make me a quiz", or wants to verify they actually learned something just discussed.
---

# any-quiz

Author a quiz, serve it in the browser, coach the user through the results.

## Procedure

### 1. Create the quiz folder

Pick a kebab-case `slug` for the topic and a random 4-hex-character `id`.

```
~/.any-quiz/<YYYY-MM-DD>-<slug>-<id>/
```

Write `meta.json`:

```json
{
  "id": "a3f9",
  "slug": "rust-lifetimes",
  "title": "Rust Lifetimes & Borrowing",
  "topic": "One sentence on what this quiz covers",
  "createdAt": "2026-08-17T14:02:11Z",
  "parentQuizId": null,
  "targets": []
}
```

Write `questions.json` — schema below. Aim for 5–10 questions unless the user asks otherwise. Mix types; do not make every question multiple choice.

### 2. Serve it

```
node "${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs" <quiz-dir>
```

Run with `run_in_background: true`. Report just the URL and question count — `Quiz up: <url> — 8 questions.` Do not mention topics, entities, or anything else drawn from the questions themselves; you wrote the answer key and anything you quote from memory risks being one. Then **stop**. Do not poll, do not ask whether they are finished, do not start another task that expects their attention. The process exit is your signal.

### 3. Coach

When the process exits, you receive its stdout:

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

### 4. Follow-up quizzes

Same procedure, with `meta.json` setting `parentQuizId` to the previous quiz's `id` and `targets` to the missed question ids.

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

## Exit codes

`0` submitted · `2` invalid quiz or refused start · `3` abandoned
