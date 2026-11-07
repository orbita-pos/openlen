// The switch of the person's own assistant, like the others: on unless OPENLEN_ASSISTANT is exactly "0".
export function assistantsEnabled(): boolean {
  return process.env.OPENLEN_ASSISTANT !== "0";
}
