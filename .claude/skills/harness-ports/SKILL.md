---
name: harness-ports
description: Use when adding, reviewing, or updating a harness port for any-quiz — porting the skill to a new coding-agent harness (Pi, Codex, Antigravity, Hermes, etc.), or when asked "add a harness", "port any-quiz to X", "support X harness".
---

# any-quiz harness ports

any-quiz ships one skill to several agent harnesses. This is a project-only skill for maintainers, not part of the shipped plugin — it documents the pattern so a new harness port stays consistent with the existing ones instead of reinventing structure each time.

## What's shared vs. what's per-harness

`bin/any-quiz.mjs` (built from `serve.ts` + `lib/`) is plain Node with zero harness dependency — it never changes for a port. Confirm this still holds before porting: `grep -rn "CLAUDE" --include="*.ts" --include="*.mjs" .` (excluding `node_modules`) should return nothing outside a skill's own `SKILL.md`.

Everything else in a port is one `SKILL.md` adapter plus wiring into that harness's discovery convention. Copy the procedure, question schema, flags, exit codes, and coaching/formatting instructions verbatim — they're harness-agnostic by construction. Only reword the two steps below when the harness forces it.

## The two things every harness gets asked

Before writing a new `<harness>-skills/any-quiz/SKILL.md`, check that harness's docs for:

1. **How a skill resolves its own bundled script's path.** Claude Code plugins get an env var (`${CLAUDE_PLUGIN_ROOT}`) because the Bash tool's cwd isn't the plugin directory. Pi has no such variable — its convention is a path relative to the skill's own directory, which the agent resolves itself from the absolute path it read `SKILL.md` from. Don't assume either mechanism transfers; read the harness's skills/extensions docs for its actual convention.
2. **Whether the harness's shell/bash tool supports backgrounding a long-lived process.** The server blocks until the quiz is submitted or abandoned — could be minutes. Claude Code has `run_in_background` plus an exit notification, so the skill backgrounds it, reports the URL, and stops until notified. Pi has no background bash by design, so its skill runs the command in the foreground, reports the URL *before* the blocking call (since no chat output is possible once it's blocked), and treats the call returning as the wait. A harness may support neither, one, or both — check before assuming.

Everything downstream of the server call (the stdout JSON contract, grading, coaching) doesn't change no matter the answer to either question.

## Process

1. Read the target harness's own docs for skill discovery (file/frontmatter format, where skills are loaded from) and for the two questions above.
2. Create `<harness>-skills/any-quiz/SKILL.md`, starting from an existing adapter (`skills/any-quiz/SKILL.md` or `pi-skills/any-quiz/SKILL.md`) and changing only what the two questions above force.
3. Wire discovery per that harness's own manifest convention (a plugin manifest directory, a `package.json` field, a settings entry — whatever that harness uses; don't invent a new one).
4. Add install instructions to the README's Install section and a row to the Harnesses table.
5. Run `npm run check` — the port must not touch `bin/`, `lib/`, or `app/`, so lint/typecheck/test should pass unchanged.

## Precedent

| Harness | Skill | Manifest | Script path | Long-lived process |
|---|---|---|---|---|
| Claude Code | `skills/any-quiz/SKILL.md` | `.claude-plugin/` | `${CLAUDE_PLUGIN_ROOT}/bin/any-quiz.mjs` | backgrounded, exit notification |
| Pi | `pi-skills/any-quiz/SKILL.md` | `pi` key in `package.json` | `../../bin/any-quiz.mjs` (relative to skill dir) | foreground, blocks on the call |
