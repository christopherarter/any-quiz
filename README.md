# any-quiz

A Claude Code skill for ad-hoc interactive quizzes. Claude writes a quiz mid-conversation, you take it in the browser, and your answers flow back into the same session so Claude can grade the open-ended ones and coach you through the misses.

Zero runtime dependencies. Node 22.18+.

## Install

    ln -s "$PWD" ~/.claude/skills/any-quiz

Then ask Claude to quiz you on something. No `npm install` — `serve.ts` runs on Node's native TypeScript support and the frontend bundle is committed.

## Run a quiz by hand

    node serve.ts examples/all-types

The server opens your browser, autosaves as you type, and exits when you click Done — printing the results as JSON on stdout.

## Question types

`mcq`, `multi`, `blank`, `short`, `code`, `match`. The first two, plus `blank` and `match`, are scored by the server; `short` and `code` come back marked for grading, which is the part a session is actually good at. Any question can be flagged "not sure", and that flag is reported alongside the answer — a right answer someone flagged is worth more coaching than a right answer they were sure of.

See `SKILL.md` for the authoring schema.

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

`app/dist/` is committed so the skill installs with nothing but a symlink. **Run `npm run build` and commit the result whenever you change anything under `app/`** — a Vitest check fails if the bundle is stale.
