import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import { DIST_DIR, isDistFresh, readStampedHash, sourceHash } from '../lib/buildinfo.ts'

const HEX64 = /^[0-9a-f]{64}$/

test('sourceHash is a stable 64-character hex digest', () => {
  const first = sourceHash()
  expect(first).toMatch(HEX64)
  expect(sourceHash()).toBe(first)
})

test('readStampedHash returns null when nothing has been built', () => {
  if (existsSync(`${DIST_DIR}/.buildinfo.json`)) {
    return
  }
  expect(readStampedHash()).toBeNull()
  expect(isDistFresh()).toBe(false)
})

test.skipIf(!existsSync(DIST_DIR))(
  'the committed bundle matches the current frontend sources',
  () => {
    // biome-ignore lint/suspicious/noMisplacedAssertion: biome does not recognize test.skipIf(...)(...) as a test() call; this callback is the test body vitest actually runs
    expect(isDistFresh(), 'app/dist is stale — run `npm run build` and commit the result').toBe(
      true,
    )
  },
)
