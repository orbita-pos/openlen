// The switch of the person's own assistant, like the others: on unless OPENLEN_ASSISTANT is exactly "0".
export function assistantsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_ASSISTANT !== "0";
}
