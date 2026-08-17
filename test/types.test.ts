import { expectTypeOf, test } from 'vitest'
import type { PublicQuestion, Question, QuestionType } from '../lib/types.ts'

test('Question is a union of all six types', () => {
  expectTypeOf<QuestionType>().toEqualTypeOf<
    'mcq' | 'multi' | 'blank' | 'short' | 'code' | 'match'
  >()
})

test('PublicQuestion has no answer or rationale on any member', () => {
  expectTypeOf<PublicQuestion>().not.toHaveProperty('answer')
  expectTypeOf<PublicQuestion>().not.toHaveProperty('rationale')
})

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

test('PublicQuestion keeps its discriminant and the fields the browser needs', () => {
  type Mcq = Extract<PublicQuestion, { type: 'mcq' }>
  expectTypeOf<Mcq['choices']>().toEqualTypeOf<import('../lib/types.ts').Choice[]>()
  type Code = Extract<PublicQuestion, { type: 'code' }>
  expectTypeOf<Code['language']>().toEqualTypeOf<string>()
})

test('narrowing on type gives access only to that member fields', () => {
  const narrow = (q: Question): string[] => {
    if (q.type === 'multi') {
      return q.answer
    }
    if (q.type === 'match') {
      return Object.keys(q.answer)
    }
    return []
  }
  expectTypeOf(narrow).returns.toEqualTypeOf<string[]>()
})
