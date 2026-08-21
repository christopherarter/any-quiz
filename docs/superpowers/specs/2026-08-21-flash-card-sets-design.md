# Flash Card Sets — Design

**Date:** 2026-08-21
**Status:** Approved, ready for implementation planning
**Builds on:** `docs/superpowers/specs/2026-08-17-any-quiz-design.md` (the base any-quiz design). This document describes only the delta.

## Purpose

any-quiz today models a single graded attempt: Claude authors a quiz, the user answers once, submitting ends the attempt, and Claude coaches from the result. That's wrong for material the user wants to drill repeatedly (vocabulary, syntax, facts) rather than take once and move on.

A **flash card set** is a new kind of quiz folder: same authoring and serving machinery, but restricted to auto-scored question types, runnable an arbitrary number of times in one sitting, with each run's score appended to a history the user can see trend over.

## Success criteria

1. A set is fully self-scoring — no question type in a set ever needs Claude's grading, so a run's result is available the instant the user submits it, with no round-trip back to a session.
2. The same CLI invocation that served the first run keeps serving subsequent runs; re-running does not mean re-invoking the CLI.
3. Question order reshuffles each run so repeated study doesn't become positional memorization.
4. Existing quizzes are unaffected: a `meta.json` with no `kind` field behaves exactly as it does today.
5. When the user is done for the sitting, Claude gets a wrap-up payload covering every run in that sitting — trend and weak spots — the same "process exit is the signal" pattern the quiz flow already uses.

## Non-goals

- Spaced repetition / per-card scheduling across sittings. A set reshuffles order within a sitting; it does not track a leitner box or resurface weak cards more often across separate invocations. That's a bigger scheduling subsystem and not needed for "run it a few times right now."
- `short` / `code` cards. Both require Claude's grading, which conflicts with a set being runnable standalone with an immediate result. Excluded entirely — the validator rejects them in a set.
- Tab-close detection. Nothing server-side reliably learns that a browser tab closed. The existing SIGINT/SIGTERM path (already used for quiz abandonment) covers "the sitting ended without an explicit Finish click."
- A UI for browsing history across sittings. `history.json` is the record; nothing new renders it.

## Data model

### `meta.json`

New optional field:

```json
{ "kind": "set" }
```

`kind` is `'quiz' | 'set'`. Absent → `'quiz'`. No other `meta.json` field changes; `parentQuizId` / `targets` (the quiz follow-up lineage) are meaningless for a set and stay `null` / `[]`.

### `questions.json`

Same shape as today. `validateQuestions(doc, kind)` gains a second parameter (default `'quiz'`, preserving every existing call site's behavior). When `kind === 'set'`, any question of type `short` or `code` is a validation error: `` `${id}: type "${type}" is not allowed in a flash card set` ``. `loadFull` reads `meta.json` first and passes `meta.kind ?? 'quiz'` into the validator.

### `answers.json`

One new optional field: `order?: string[]` — the current run's question order, sets only. For a set, `status` never becomes `'submitted'`; it stays `'draft'` for the whole sitting, and a fresh `order` is written every time a run completes. (This is also why the CLI's `--retake` gate needs no changes: that gate only fires on `status === 'submitted'`, which a set never reaches.)

The skeleton builder (`skeleton()` in `lib/quiz.ts`) gains a `kind` parameter: for `'set'`, it shuffles `questionIds` into `order`; for `'quiz'`, `order` is omitted, exactly as today.

### `history.json` — new file, sets only

```json
{
  "version": 1,
  "runs": [
    { "ranAt": "2026-08-21T14:05:02Z", "correct": 7, "total": 10,
      "perQuestion": { "c1": true, "c2": false },
      "flagged": ["c2"] }
  ]
}
```

One entry appended per completed run. `lib/quiz.ts` gains `historyPath(dir)`, `readHistory(dir)`, `appendHistoryEntry(dir, entry)` — mirroring the existing `answersPath` / `readAnswers` / `writeAnswers` trio, same atomic tmp-file-then-rename write.

## Server (`lib/server.ts`)

`QuizContext` gains `kind: 'quiz' | 'set'` (from `meta.kind ?? 'quiz'`).

- `GET /api/quiz`, `GET/PUT /api/answers` — unchanged. `PUT` already round-trips whatever shape `answers.json` has, so `order` passes through untouched.
- `POST /api/submit` branches on `ctx.kind`:
  - `'quiz'`: byte-for-byte the existing handler.
  - `'set'`: score the current responses with the existing `scoreQuiz` (the validator already guarantees `needsGrading` comes back empty), `appendHistoryEntry` with `{ranAt: now, correct, total, perQuestion, flagged}`, then overwrite `answers.json` with a fresh skeleton (`status: 'draft'`, empty responses, newly shuffled `order`). Respond `{ok: true, result: {correct, total, perQuestion}}`. No event emitted — the server keeps running.
- New `POST /api/finish`, registered only when `ctx.kind === 'set'`: reads `history.json`, emits `'finished'` with `{quizId, quizDir, kind: 'set', runs}`, responds `{ok: true}`. Uses the same `emitSubmitted`-style closure the submit handler already uses (renamed generically or given a sibling `emitFinished` — implementation detail for the plan).

## CLI (`serve.ts`)

- Listens for `'finished'` the same way it listens for `'submitted'`: write payload to stdout, `shutdown(server, EXIT_OK)`.
- SIGINT/SIGTERM handler branches on `kind`:
  - `'quiz'`: unchanged — abandon message, exit `3`.
  - `'set'`: read `history.json`. If it has ≥1 run, treat it like a finish (write the same payload `POST /api/finish` would have produced, exit `0`). If zero runs, today's abandon message, exit `3`.
- `--retake`: no code change needed (see the `answers.json` section above) — it simply never triggers for a set.

## Frontend

Reuses `useQuiz.ts` / `Quiz.tsx` rather than a parallel hook and component. The load, autosave, and per-question editing logic is identical between a quiz and a set; only the submit result and end state differ, and branching that in place is a smaller, more consistent diff than duplicating ~90% of the hook.

- `useQuiz` reorders `questions` by `answers.order` when present, before returning them to the component.
- `QuizState` gains `runResult: {correct, total} | null`.
- Submit branches on `meta.kind`:
  - `'quiz'`: unchanged (`postSubmit` → status `'submitted'`).
  - `'set'`: `postSubmit` returns the run result; on success, refetch `/api/answers` (picks up the server's fresh, reshuffled draft), reseed the editor from it, set `runResult`, status stays `'ready'`.
- New `finish()` action, meaningful for sets only: `POST /api/finish` → status `'submitted'`, which reuses the existing terminal "Answers sent back to Claude" screen exactly as-is.
- `Quiz.tsx`: when `runResult` is non-null, the footer swaps from progress+Done to a score line ("7/10") plus two buttons, "Run again" (clears `runResult`; the underlying state is already fresh) and "Finish studying" (calls `finish()`). For a set with no `runResult` yet, the Done button reads "Check answers" instead of "Done" — same click handler, different label, since `handleDone`'s confirm-before-send behavior for unanswered questions is unchanged and still useful mid-run.

## Skill (`skills/any-quiz/SKILL.md`)

- New authoring section: trigger phrases ("make me a flash card set on X", "let me drill X"), `meta.kind: "set"`, the type restriction (`mcq`/`multi`/`blank`/`match` only — no `short`/`code`), same folder root (`~/.any-quiz/<date>-<slug>-<id>/`) and same CLI invocation as a quiz.
- Same launch instructions as quiz step 2: report URL + card count, run in background, stop, don't poll.
- New wrap-up step, parallel to quiz's coaching step: the stdout payload on exit is `runs` for the whole sitting. Claude reports the score trend across runs and which card ids missed most — no grading step, since every type in a set is auto-scored.
- Exit code table gains the set meanings: `0` = submitted (quiz) or finished with ≥1 run (set); `2` unchanged; `3` = abandoned (quiz) or closed with zero runs completed (set).

## Testing

- `question-schema`: set-kind rejects `short`/`code`, accepts the other four; `kind` defaults to `'quiz'` when omitted.
- `quiz.ts`: `history.json` read/write/append; skeleton shuffle produces `order` for `'set'` and omits it for `'quiz'`.
- `server.ts`: submit-for-set branch (score, append history, reset+reshuffle, response shape); `/api/finish` only exists when `kind === 'set'`.
- `serve.ts` / CLI: `'finished'` event → stdout + exit 0; SIGINT/SIGTERM branch for a set with runs vs. zero runs.
- `useQuiz` / `Quiz.tsx`: run-again flow (score shown, state resets, reorders on next load), finish flow (terminal screen), Done-label swap.
- Per repo convention: `npm run build` and commit the refreshed `app/dist/` + `bin/any-quiz.mjs` bundles — a Vitest check fails on a stale bundle.

## Open questions

None. All decisions resolved during brainstorming.
