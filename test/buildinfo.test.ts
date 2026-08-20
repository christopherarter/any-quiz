import { existsSync } from 'node:fs'
import { expect, test } from 'vitest'
import {
  BIN_FILE,
  DIST_DIR,
  isBinFresh,
  isDistFresh,
  readBinStampedHash,
  readStampedHash,
  sourceHash,
} from '../lib/buildinfo.ts'

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
    expect(isDistFresh(), 'app/dist is stale — run `npm run build` and commit the result').toBe(
      true,
    )
  },
)

test('readBinStampedHash returns null when nothing has been built', () => {
  if (existsSync(BIN_FILE)) {
    return
  }
  expect(readBinStampedHash()).toBeNull()
  expect(isBinFresh()).toBe(false)
})

test('bin/any-quiz.mjs, the dependency-free server bundle the skill ships, exists', () => {
  expect(existsSync(BIN_FILE), 'run `npm run build` and commit the result').toBe(true)
})

test.skipIf(!existsSync(BIN_FILE))(
  'the committed server bundle matches the current serve.ts + lib sources',
  () => {
    expect(
      isBinFresh(),
      'bin/any-quiz.mjs is stale — run `npm run build` and commit the result',
    ).toBe(true)
  },
)
