import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { expect, test } from 'vitest'
import { BIN_FILE, DIST_DIR } from '../lib/buildinfo.ts'

const FIXTURE = new URL('../examples/all-types', import.meta.url)
const READY_MARKER = /any-quiz: http/
const READY_TIMEOUT_MS = 5000

// Copies the bundle (plus the app/dist it serves, one level below it -- the same layout
// as the real repo) into a temp dir with no node_modules anywhere in its parent chain --
// os.tmpdir() has no ancestor node_modules -- so a resolvable import of `hono` or `zod`
// here can only mean esbuild left a bare specifier in the bundle instead of inlining it.
function isolatedBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), 'any-quiz-bin-'))
  const bundlePath = join(dir, 'bin', 'any-quiz.mjs')
  mkdirSync(join(dir, 'bin'))
  cpSync(BIN_FILE, bundlePath)
  cpSync(DIST_DIR, join(dir, 'app', 'dist'), { recursive: true })
  return bundlePath
}

function freshQuizDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'any-quiz-quiz-'))
  cpSync(FIXTURE, dir, { recursive: true })
  return dir
}

test.skipIf(!existsSync(BIN_FILE))(
  'the bundled server starts from a directory with no node_modules ancestor',
  async () => {
    const bundlePath = isolatedBundle()
    const quizDir = freshQuizDir()
    const child = spawn(process.execPath, [bundlePath, quizDir, '--port', '0', '--no-open'])

    const ready = await new Promise<string>((resolve, reject) => {
      let stderr = ''
      const timer = setTimeout(
        () => reject(new Error(`timed out; stderr so far: ${stderr}`)),
        READY_TIMEOUT_MS,
      )
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
        if (READY_MARKER.test(stderr)) {
          clearTimeout(timer)
          resolve(stderr)
        }
      })
      child.on('error', reject)
      child.on('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`exited early with code ${code}; stderr: ${stderr}`))
      })
    })

    expect(ready).not.toContain('Cannot find package')
    child.kill()
  },
)
