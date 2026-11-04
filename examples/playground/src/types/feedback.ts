/** Mirrors `Trace` in backend/app/routers/feedback.py. */
export interface Trace {
  run_id: string
  thread_id: string
  started_at: string
  tone: string
  temperature: number
  input_tokens: number
  output_tokens: number
  /** message id → rating, for messages this run produced */
  ratings: Record<string, Rating>
}

export type Rating = 'up' | 'down'
