import { chmodSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { BIN_FILE, DIST_DIR, serverSourceHash, sourceHash } from '../lib/buildinfo.ts'

const STAMP_PREFIX_LENGTH = 12
// rwxr-xr-x: esbuild's output isn't marked executable, and the shebang line only helps
// once the file actually has the bit set.
const EXECUTABLE_MODE = 0o755

function stamp(dir: string, hash: string, label: string): void {
  const value = { sourceHash: hash, stampedAt: new Date().toISOString() }
  writeFileSync(join(dir, '.buildinfo.json'), `${JSON.stringify(value, null, 2)}\n`)
  process.stderr.write(`any-quiz: stamped ${label} with ${hash.slice(0, STAMP_PREFIX_LENGTH)}\n`)
}

stamp(DIST_DIR, sourceHash(), 'app/dist')
chmodSync(BIN_FILE, EXECUTABLE_MODE)
stamp(dirname(BIN_FILE), serverSourceHash(), 'bin/any-quiz.mjs')
