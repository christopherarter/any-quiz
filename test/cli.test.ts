import { existsSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { connect, createServer as netCreateServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { openBrowser } from '../lib/open.ts'
import { parseArgs, parseScaffoldArgs } from '../serve.ts'
import { freshQuizDir, SERVE, start, startAt, URL_RE } from './support/cli-child.ts'

const OK = 200
const EXIT_OK = 0
const EXIT_BAD_INPUT = 2
const EXIT_ABANDONED = 3
const SAMPLE_PORT = 8080
const SAMPLE_QUESTION_COUNT = 6

const ARCHIVE_RE = /^answers-\d{8}T\d{6}Z\.json$/
const USAGE_RE = /usage:/
const CANNOT_READ_RE = /cannot read/
const UNKNOWN_TYPE_RE = /unknown type/
const PORT_FLAG_RE = /--port/
const RETAKE_FLAG_RE = /--retake/
const BUSY_RE = /busy/
const KIND_FLAG_RE = /--kind/

// Sends a request over a raw socket and leaves it open afterwards, exactly as a browser's
// keep-alive connection sits idle between requests. `fetch` pools connections the same
// way, but it also owns their lifetime -- doing it by hand is what makes the idle socket
// deliberate and guarantees it is still open when the submit lands.
function idleKeepAlive(base: string): Promise<Socket> {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const socket = connect({ host: hostname, port: Number(port) }, () => {
      socket.write(`GET /api/quiz HTTP/1.1\r\nHost: ${hostname}\r\nConnection: keep-alive\r\n\r\n`)
    })
    socket.once('data', () => resolve(socket))
    socket.once('error', reject)
  })
}

test('parseArgs reads the directory, port, and flags', () => {
  expect(parseArgs(['/q'])).toEqual({
    dir: '/q',
    port: 0,
    open: true,
    retake: false,
    check: false,
  })
  expect(parseArgs(['/q', '--port', '8080', '--no-open', '--retake', '--check'])).toEqual({
    dir: '/q',
    port: SAMPLE_PORT,
    open: false,
    retake: true,
    check: true,
  })
})

// parseArgs stays a pure parser: it reports what was typed, and `main` decides whether
// that is usable. Pinning NaN here keeps the validation boundary where it is instead of
// letting a later refactor quietly move rejection into the parser.
test('parseArgs does not validate the port value itself', () => {
  expect(Number.isNaN(parseArgs(['/q', '--port', 'abc']).port)).toBe(true)
  expect(Number.isNaN(parseArgs(['/q', '--port']).port)).toBe(true)
})

test('exits 2 when no quiz directory is given', async () => {
  const s = start([])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(USAGE_RE)
  expect(s.stdout()).toBe('')
})

test('exits 2 when the quiz directory does not exist', async () => {
  const s = start(['/nonexistent/quiz'])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(CANNOT_READ_RE)
  expect(s.stdout()).toBe('')
})

test('exits 2 with validation errors on stderr for a bad quiz', async () => {
  const dir = freshQuizDir()
  writeFileSync(
    join(dir, 'questions.json'),
    JSON.stringify({
      version: 1,
      questions: [{ id: 'q1', type: 'essay', prompt: 'x', answer: 'y' }],
    }),
  )
  const s = start([dir])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(UNKNOWN_TYPE_RE)
  expect(s.stdout()).toBe('')
})

test('exits 2 on an unusable --port value', async () => {
  const s = start([freshQuizDir(), '--port', 'abc'])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(PORT_FLAG_RE)
})

test('--check exits 0 with a summary and never opens a port', async () => {
  const s = start([freshQuizDir(), '--check'])
  expect(await s.exited).toBe(EXIT_OK)
  expect(s.stderr()).not.toMatch(URL_RE)
  expect(JSON.parse(s.stdout())).toEqual({
    ok: true,
    title: 'All Question Types',
    questionCount: SAMPLE_QUESTION_COUNT,
  })
})

test('scaffold subcommand creates the quiz folder and writes meta.json', async () => {
  const baseDir = mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))
  const s = start(['scaffold', baseDir, 'rust-lifetimes', 'Rust Lifetimes', 'One sentence'])
  expect(await s.exited).toBe(EXIT_OK)

  const result = JSON.parse(s.stdout())
  expect(result.meta.slug).toBe('rust-lifetimes')
  expect(result.meta.title).toBe('Rust Lifetimes')
  expect(result.meta.topic).toBe('One sentence')
  expect(existsSync(join(result.dir, 'meta.json'))).toBe(true)
})

test('scaffold subcommand exits 2 with a usage message when required args are missing', async () => {
  const s = start(['scaffold', mkdtempSync(join(tmpdir(), 'anyquiz-scaffold-'))])
  expect(await s.exited).toBe(EXIT_BAD_INPUT)
  expect(s.stderr()).toMatch(USAGE_RE)
  expect(s.stdout()).toBe('')
})

// The submit response and the process exit are driven from the same tick, so this checks
// both: the browser must receive a complete, readable 200 even though the server begins
// shutting down the instant that response is handed off. Asserting only the exit code
// would let a torn connection -- which the user sees as a failed submit -- pass as green.
test('prints only the result JSON on stdout and exits 0 after a clean submit', async () => {
  const s = start([freshQuizDir()])
  const base = await s.ready
  await fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ responses: { q1: { value: 'b', flagged: false } } }),
  })

  const submitted = await fetch(`${base}/api/submit`, { method: 'POST' })
  expect(submitted.status).toBe(OK)
  expect(await submitted.json()).toEqual({ ok: true })

  expect(await s.exited).toBe(EXIT_OK)
  const payload = JSON.parse(s.stdout())
  expect(payload.quizId).toBe('a3f9')
  expect(payload.auto.perQuestion.q1).toBe(true)
  expect(s.stderr()).toMatch(URL_RE)
})

// The handoff contract is that the session gets control back the moment the user submits,
// so a hung process is a total failure of the skill, not merely a slow exit.
// `server.close()` waits for every open connection, and a real browser always leaves idle
// keep-alive sockets behind -- so this holds one open on purpose and demands the exit anyway.
test('exits 0 on submit even while an idle keep-alive connection is still open', async () => {
  const s = start([freshQuizDir()])
  const base = await s.ready
  const socket = await idleKeepAlive(base)

  expect((await fetch(`${base}/api/submit`, { method: 'POST' })).status).toBe(OK)
  expect(await s.exited).toBe(EXIT_OK)
  expect(JSON.parse(s.stdout()).quizId).toBe('a3f9')

  socket.destroy()
})

test('refuses to re-serve a submitted quiz without --retake', async () => {
  const dir = freshQuizDir()
  const first = start([dir])
  await fetch(`${await first.ready}/api/submit`, { method: 'POST' })
  expect(await first.exited).toBe(EXIT_OK)

  const second = start([dir])
  expect(await second.exited).toBe(EXIT_BAD_INPUT)
  expect(second.stderr()).toMatch(RETAKE_FLAG_RE)
  expect(second.stdout()).toBe('')
})

test('--retake archives the previous attempt and serves a fresh one', async () => {
  const dir = freshQuizDir()
  const first = start([dir])
  await fetch(`${await first.ready}/api/submit`, { method: 'POST' })
  await first.exited

  const second = start([dir, '--retake'])
  const base = await second.ready
  expect(readdirSync(dir).some((f) => ARCHIVE_RE.test(f))).toBe(true)

  const answers = await (await fetch(`${base}/api/answers`)).json()
  expect(answers.status, 'the retake inherited the archived attempt').toBe('draft')

  second.child.kill('SIGTERM')
  expect(await second.exited).toBe(EXIT_ABANDONED)
})

test('SIGTERM exits 3 with the draft intact and nothing on stdout', async () => {
  const dir = freshQuizDir()
  const s = start([dir])
  const base = await s.ready
  await fetch(`${base}/api/answers`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ responses: { q1: { value: 'a', flagged: false } } }),
  })
  s.child.kill('SIGTERM')
  expect(await s.exited).toBe(EXIT_ABANDONED)
  expect(readdirSync(dir)).toContain('answers.json')
  expect(s.stdout()).toBe('')
})

// A busy --port must degrade to an ephemeral one rather than aborting: the caller asked
// for a convenience, not a requirement. The retry reuses the listen callback registered
// on the failed attempt, so this also pins that the banner still prints afterwards --
// without it the CLI would come up silently and no caller could find the URL.
test('a busy --port falls back to an ephemeral port and still prints the banner', async () => {
  const blocker = netCreateServer()
  await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
  const address = blocker.address()
  if (address === null || typeof address === 'string') {
    throw new Error('no port')
  }
  const busy = address.port

  const s = start([freshQuizDir(), '--port', String(busy)])
  const base = await s.ready
  expect(s.stderr()).toMatch(BUSY_RE)
  expect(base).not.toBe(`http://127.0.0.1:${busy}`)
  expect((await fetch(`${base}/api/quiz`)).status).toBe(OK)

  s.child.kill('SIGTERM')
  await s.exited
  blocker.close()
})

// Returning false (rather than throwing, or spawning a command that does not exist) is
// what lets `main` fall back to printing the URL for the user to open by hand.
test('openBrowser reports failure on a platform it has no launcher for', () => {
  expect(openBrowser('http://127.0.0.1:1234', 'plan9')).toBe(false)
})

// The README installs the skill as a symlink into ~/.claude/skills, which makes
// `process.argv[1]` the link while the module resolves to its target. Comparing those two
// paths directly leaves `main` unrun: the CLI exits 0 having printed nothing, so the skill
// appears installed and quietly does nothing.
test('runs when invoked through a symlink, as the install instructions do', async () => {
  const link = join(mkdtempSync(join(tmpdir(), 'anyquiz-link-')), 'serve.ts')
  symlinkSync(SERVE, link)
  const s = startAt(link, [freshQuizDir()])

  const base = await s.ready

  expect(base).toMatch(URL_RE)
  s.child.kill('SIGINT')
  expect(await s.exited).toBe(EXIT_ABANDONED)
})

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
  expect(s.stderr()).toMatch(KIND_FLAG_RE)
  expect(s.stdout()).toBe('')
})
