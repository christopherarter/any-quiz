import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { DIST_DIR, sourceHash } from '../lib/buildinfo.ts'

const STAMP_PREFIX_LENGTH = 12

const stamp = { sourceHash: sourceHash(), stampedAt: new Date().toISOString() }
writeFileSync(join(DIST_DIR, '.buildinfo.json'), `${JSON.stringify(stamp, null, 2)}\n`)
process.stderr.write(
  `any-quiz: stamped app/dist with ${stamp.sourceHash.slice(0, STAMP_PREFIX_LENGTH)}\n`,
)
