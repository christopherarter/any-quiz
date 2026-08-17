# Task 2 Report: Type Model

## Summary

Successfully created the `Question` discriminated union and derived `PublicQuestion` type in `lib/types.ts`, with comprehensive type tests in `test/types.test.ts`.

## Files Created

1. **`lib/types.ts`** (74 lines)
   - 6 question types: `mcq`, `multi`, `blank`, `short`, `code`, `match`
   - Discriminated union `Question` with type-specific fields
   - `QuestionType` extracted from union
   - `PublicQuestion` derived via `Strip` distributive conditional (removes `answer` and `rationale`)
   - Additional types: `AnswerValue`, `ResponseEntry`, `Answers`, `Meta`, `QuestionsDoc`, `ResultPayload`
   - All non-export statements placed before exports per Biome lint rule

2. **`test/types.test.ts`** (30 lines)
   - 4 type tests using `expectTypeOf` from vitest
   - Tests: union composition, property removal, discriminant preservation, type narrowing
   - All if statements use block braces per Biome lint rule

## Commands Run and Results

### Step 1: Write test (✓)
```bash
# Wrote test/types.test.ts with 4 type tests
```

### Step 2: Run test before implementation
```bash
$ npx vitest run test/types.test.ts
PASS (4) FAIL (0)
```
Status: This result is expected-and-uninformative. Under `verbatimModuleSyntax`, `import type` statements are erased before runtime, so module resolution never occurs and the missing `lib/types.ts` is never reached. Additionally, `expectTypeOf(...)` is a runtime no-op. Therefore, a type-only test file cannot fail under `vitest run` even when its imports don't exist. The actual red state is demonstrated via `npx tsc --noEmit` in the **Critical Fix: Correct the Red Step** section below, which shows the real type errors when `lib/types.ts` is absent.

### Step 3: Write implementation (✓)
Wrote `lib/types.ts` following the brief exactly, with organization corrections for Biome lint rules.

### Step 4: Verify tests pass with full checks
```bash
$ npm run check
```
Output:
- **Lint (Biome)**: "Checked 11 files in 49ms. No fixes applied." ✓
- **Typecheck (tsc)**: No errors ✓
- **Tests (vitest)**: "Test Files 2 passed (2), Tests 7 passed (7)" ✓

### Step 5: Commit
```bash
$ git add lib/types.ts test/types.test.ts
$ git commit -m "feat: add the Question discriminated union and derived public type"
```
Commit SHA: `e984518`

## Implementation Details

### Question Type Structure
The `Question` union uses a `Base` interface for common fields, then extends it with type-specific configurations:
- **mcq**: Single choice from `choices[]`, answer is `string`
- **multi**: Multiple choices from `choices[]`, answer is `string[]`
- **blank**: Fill-in blanks from `blanks[]`, answer is `Record<string, string[]>`
- **short**: Free text, answer is `string`
- **code**: Code submission, answer is `string`, with `language` field
- **match**: Matching pairs with left/right, answer is `Record<string, string>`

### PublicQuestion Derivation
Uses distributive conditional type:
```ts
type Strip<T> = T extends unknown ? Omit<T, 'answer' | 'rationale'> : never
```
This ensures every new field added to `Question` automatically appears in `PublicQuestion` (minus the omitted fields), preventing drift.

## Lint Corrections Applied

Initial linting revealed two issues, both corrected:
1. **useExportsLast**: Reordered to place non-export statements (`Base`, `Strip`) before all exports
2. **useBlockStatements**: Wrapped single-line if statements in the test with braces

## Concerns

None. All steps completed successfully with all tests passing, linting clean, and typecheck passing.

---

# Fix Round 1: Critical and Important Issues

## Critical Fix: Correct the Red Step

**Issue:** The brief's Step 2 ("run `npx vitest run test/types.test.ts`") cannot produce a FAIL because type-only imports are erased before runtime, so `import type` never goes through module resolution. The test file shows PASS because `expectTypeOf()` is a runtime no-op.

**Root Cause:** Under `verbatimModuleSyntax`, type-only imports are erased at compile time, making runtime test failure impossible for this test class.

**Correction:** The actual red step is `npx tsc --noEmit`, which enforces type assertions during typecheck (which `npm run check` includes).

**Demonstration — without `lib/types.ts`:**
```
$ mv lib/types.ts /tmp/backup && npx tsc --noEmit
test/types.test.ts(2,61): error TS2307: Cannot find module '../lib/types.ts'
test/types.test.ts(11,38): error TS2554: Expected 2 arguments, but got 1.
test/types.test.ts(12,38): error TS2554: Expected 2 arguments, but got 1.
test/types.test.ts(17,55): error TS2307: Cannot find module '../lib/types.ts'
TypeScript: 4 errors in 1 files
```
(Then restored `lib/types.ts`.)

## Important Fix: Per-Member Type Assertions

**Issue:** The union-level assertion `expectTypeOf<PublicQuestion>().not.toHaveProperty('answer')` only fails if `answer` survives on *all* members. If a change leaks `answer` onto just one member (e.g., `blank`), the test silently passes because `keyof` over a union is an intersection of member keys.

**Fix:** Added per-member assertions covering all 6 types:
```ts
test('each PublicQuestion member has no answer or rationale', () => {
  expectTypeOf<Extract<PublicQuestion, { type: 'mcq' }>>().not.toHaveProperty('answer')
  expectTypeOf<Extract<PublicQuestion, { type: 'mcq' }>>().not.toHaveProperty('rationale')
  expectTypeOf<Extract<PublicQuestion, { type: 'multi' }>>().not.toHaveProperty('answer')
  expectTypeOf<Extract<PublicQuestion, { type: 'multi' }>>().not.toHaveProperty('rationale')
  expectTypeOf<Extract<PublicQuestion, { type: 'blank' }>>().not.toHaveProperty('answer')
  expectTypeOf<Extract<PublicQuestion, { type: 'blank' }>>().not.toHaveProperty('rationale')
  expectTypeOf<Extract<PublicQuestion, { type: 'short' }>>().not.toHaveProperty('answer')
  expectTypeOf<Extract<PublicQuestion, { type: 'short' }>>().not.toHaveProperty('rationale')
  expectTypeOf<Extract<PublicQuestion, { type: 'code' }>>().not.toHaveProperty('answer')
  expectTypeOf<Extract<PublicQuestion, { type: 'code' }>>().not.toHaveProperty('rationale')
  expectTypeOf<Extract<PublicQuestion, { type: 'match' }>>().not.toHaveProperty('answer')
  expectTypeOf<Extract<PublicQuestion, { type: 'match' }>>().not.toHaveProperty('rationale')
})
```

**Proof the test bites:** Temporarily modified `Strip` to skip the `blank` type:
```ts
type Strip<T> = T extends { type: 'blank' }
  ? T
  : T extends unknown
    ? Omit<T, 'answer' | 'rationale'>
    : never
```

Ran `npm run typecheck`:
```
test/types.test.ts(20,66): error TS2554: Expected 2 arguments, but got 1.
test/types.test.ts(21,66): error TS2554: Expected 2 arguments, but got 1.
```
(Lines 20-21 are the per-member assertions for `blank`.)

Reverted the bug. Tests now pass.

## Additional Fix: Exclude Claude Code Harness Files from Biome

**Issue:** Biome was linting `.claude/settings.local.json` and `.claude/skills/ironlint-config/.ironlint-adapter.json`, which are Claude Code harness files that appear and change independently. This made `npm run check` non-deterministic.

**Fix:** Added `"!.claude"` to `files.includes` in `biome.jsonc`:
```jsonc
"files": { "includes": ["**", "!app/dist", "!.claude"] },
```

## Final Verification

```bash
$ npm run check
> npm run lint && npm run typecheck && npm run test
> biome check .
Checked 11 files in 60ms. No fixes applied.
> tsc --noEmit
> vitest run
 RUN  v4.1.10 /Users/chrisarter/Documents/projects/any-quiz
 Test Files  2 passed (2)
      Tests  8 passed (8)
   Start at  12:08:54
   Duration  83ms (transform 19ms, setup 0ms, import 28ms, tests 3ms, environment 0ms)
```

All checks pass with no warnings or errors. Tests increased from 7 to 8 (added 1 new test).
