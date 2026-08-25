import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Not a *.test.ts file on purpose: vitest only collects `test/**/*.test.ts`, so this is
// shared setup rather than a suite of its own.

const SERVE = fileURLToPath(new URL('../../serve.ts', import.meta.url))
const FIXTURE = fileURLToPath(new URL('../../examples/all-types', import.meta.url))
const SET_FIXTURE = fileURLToPath(new URL('../../examples/set-example', import.meta.url))

export const URL_RE = /http:\/\/127\.0\.0\.1:(\d+)/

export interface Child {
  child: ReturnType<typeof spawn>
  ready: Promise<string>
  exited: Promise<number | null>
  stdout: () => string
  stderr: () => string
}

export function freshQuizDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-cli-'))
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}

export function freshSetDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'anyquiz-cli-set-'))
  cpSync(SET_FIXTURE, dir, { recursive: true })
  return dir
}

// Starts serve.ts as a real child process and resolves the base URL once the banner
// appears on stderr. Every assertion about exit codes and stream separation has to go
// through a real process -- calling `main()` in-process could observe neither.
export function start(args: string[]): Child {
  return startAt(SERVE, args)
}

// Same as `start`, but with the entry path spelled out, so a test can run the CLI through
// a symlink the way the documented install does.
export function startAt(entry: string, args: string[]): Child {
  const child = spawn(process.execPath, [entry, ...args, '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let err = ''
  child.stdout?.on('data', (d: Buffer) => {
    out += String(d)
  })
  child.stderr?.on('data', (d: Buffer) => {
    err += String(d)
  })
  const exited = new Promise<number | null>((resolve) => child.on('exit', resolve))
  const ready = new Promise<string>((resolve, reject) => {
    const check = (): void => {
      const m = URL_RE.exec(err)
      if (m) {
        resolve(`http://127.0.0.1:${m[1]}`)
      }
    }
    child.stderr?.on('data', check)
    child.on('exit', () => reject(new Error(`exited early:\n${err}`)))
  })
  // The exit-2 tests never await `ready`, so without this the early-exit rejection above
  // surfaces as an unhandled rejection and fails the run for the wrong reason.
  ready.catch(() => undefined)
  return { child, ready, exited, stdout: () => out, stderr: () => err }
}

export { SERVE }
