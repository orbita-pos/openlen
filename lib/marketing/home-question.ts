// The home's question (Jesús, 06/11): «¿Con qué empezamos?», like Gemini's, and different with the visitor's own time
// of day, the way claude.ai's greeting changes from morning to night. The questions live in each locale's
// `marketing.hero.questions.<slot>` (several per slot); `hero.question` is the neutral one the server renders.

export type QuestionSlot = "morning" | "afternoon" | "evening" | "night";

/** Morning 5–12 h, afternoon 12–19 h, evening 19–24 h, night 0–5 h, on the visitor's clock. */
export function questionSlot(hour: number): QuestionSlot {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 19) return "afternoon";
  if (hour >= 19) return "evening";
  return "night";
}

/** One of the slot's questions for a random number in [0, 1]; `null` for an empty list, so the default stays. */
export function pickQuestion(questions: readonly string[], random: number): string | null {
  if (questions.length === 0) return null;
  return questions[Math.min(questions.length - 1, Math.floor(random * questions.length))] ?? null;
}
