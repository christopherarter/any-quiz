import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const APP_DIR = join(ROOT, 'app')
const DIST_DIR_PATH = join(APP_DIR, 'dist')
const STAMP = join(DIST_DIR_PATH, '.buildinfo.json')

// Anything Vite bundles into app/dist. Tests are excluded: they never ship, so a
// test-only edit must not mark the committed bundle stale.
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.css', '.html']
const TEST_FILE = /\.test\.tsx?$/
const isSource = (path: string): boolean =>
  SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext)) && !TEST_FILE.test(path)

const SKIPPED_ENTRIES = new Set(['dist', 'node_modules'])

function walk(dir: string, out: string[] = []): string[] {
  const entries = readdirSync(dir)
    .sort()
    .filter((entry) => !SKIPPED_ENTRIES.has(entry))
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      walk(path, out)
    } else if (isSource(path)) {
      out.push(path)
    }
  }
  return out
}

function readStamp(): string | null {
  if (!existsSync(STAMP)) {
    return null
  }
  try {
    const parsed = JSON.parse(readFileSync(STAMP, 'utf8')) as { sourceHash?: unknown }
    if (typeof parsed.sourceHash === 'string') {
      return parsed.sourceHash
    }
    return null
  } catch {
    return null
  }
}

export function sourceHash(): string {
  const hash = createHash('sha256')
  for (const path of walk(APP_DIR)) {
    hash.update(relative(ROOT, path))
    hash.update('\u0000')
    hash.update(readFileSync(path))
    hash.update('\u0000')
  }
  return hash.digest('hex')
}

export function readStampedHash(): string | null {
  return readStamp()
}

export function isDistFresh(): boolean {
  const stamped = readStampedHash()
  return stamped !== null && stamped === sourceHash()
}

export const DIST_DIR = DIST_DIR_PATH
