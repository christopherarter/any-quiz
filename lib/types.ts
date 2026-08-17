interface Base {
  id: string
  prompt: string
  rationale: string
  points?: number
}

// Distributes across the union so each member is stripped individually and keeps
// its own discriminant. A mapped type cannot iterate a union of object types.
type Strip<T> = T extends unknown ? Omit<T, 'answer' | 'rationale'> : never

export interface Choice {
  id: string
  text: string
}

export interface Blank {
  id: string
  hint?: string
}

export type Question =
  | (Base & { type: 'mcq'; choices: Choice[]; answer: string })
  | (Base & { type: 'multi'; choices: Choice[]; answer: string[] })
  | (Base & { type: 'blank'; blanks: Blank[]; answer: Record<string, string[]> })
  | (Base & { type: 'short'; answer: string })
  | (Base & { type: 'code'; language: string; answer: string })
  | (Base & { type: 'match'; left: Choice[]; right: Choice[]; answer: Record<string, string> })

export type QuestionType = Question['type']

export type PublicQuestion = Strip<Question>

export type AnswerValue = string | string[] | Record<string, string>

export interface ResponseEntry {
  value: AnswerValue | null
  flagged: boolean
}

export interface Answers {
  quizId: string
  status: 'draft' | 'submitted'
  startedAt: string
  updatedAt: string
  submittedAt: string | null
  responses: Record<string, ResponseEntry>
}

export interface Meta {
  id: string
  slug: string
  title: string
  topic: string
  createdAt: string
  parentQuizId: string | null
  targets: string[]
}

export interface QuestionsDoc {
  version: 1
  questions: Question[]
}

export interface ResultPayload {
  quizId: string
  quizDir: string
  auto: { correct: number; total: number; perQuestion: Record<string, boolean> }
  needsGrading: string[]
  flagged: string[]
  responses: Record<string, ResponseEntry>
}
