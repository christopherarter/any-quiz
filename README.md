# AnyQuiz

<img src="assets/any-quiz.png" alt="any-quiz" width="760">

A Claude Code skill for ad-hoc interactive quizzes to let Claude coach you through a quiz. Claude writes a quiz mid-conversation, you take it in the browser, and your answers flow back into the same session so Claude can grade the open-ended ones and coach you through the misses.

Anything in Claude's context can be used to create a quiz.

Ships as a Claude Code plugin. Requires Node 22.

## Install

```
claude plugin marketplace add christopherarter/any-quiz
claude plugin install any-quiz@any-quiz
```

Then ask Claude to quiz you on something.


## Question types

`mcq`, `multi`, `blank`, `short`, `code`, `match`. The first two, plus `blank` and `match`, are scored by the server; `short` and `code` come back marked for grading, which is the part a session is actually good at. Any question can be flagged "not sure", and that flag is reported alongside the answer — a right answer someone flagged is worth more coaching than a right answer they were sure of.

See `skills/any-quiz/SKILL.md` for the authoring schema.

## Layout

Each quiz is a folder under `~/.any-quiz/`:

    2026-08-17-rust-lifetimes-a3f9/
      meta.json       title, topic, follow-up lineage
      questions.json  prompts plus the answer key
      answers.json    your responses, written as you go

The answer key lives in `questions.json` but is stripped before anything reaches the browser, and the browser is typed against `PublicQuestion` so reading it is a compile error.

Submitting closes the attempt. Re-serving the same folder needs `--retake`, which archives the finished attempt rather than overwriting it.

## Develop

    npm install
    npm run check      # lint, typecheck, test

    npm run dev:api    # terminal 1 — API on :4711
    npm run dev:web    # terminal 2 — Vite with HMR, proxies /api

`app/dist/` and `bin/any-quiz.mjs` are committed so the plugin ships with nothing to install beyond itself. **Run `npm run build` and commit the result whenever you change anything under `app/`, `lib/`, or `serve.ts`** — a Vitest check fails if either bundle is stale.

To try the plugin from a local clone without publishing it, point Claude Code at the working copy directly: `claude plugin marketplace add /path/to/any-quiz && claude plugin install any-quiz@any-quiz`.
