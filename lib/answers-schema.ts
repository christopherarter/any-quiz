import { z } from 'zod'

const AnswerValueSchema = z.union([
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.string()),
])

const ResponseEntrySchema = z.object({
  value: AnswerValueSchema.nullable().optional(),
  flagged: z.boolean().optional(),
})

const PutAnswersBodySchema = z.object({
  responses: z.record(z.string(), ResponseEntrySchema),
})

export { PutAnswersBodySchema }
