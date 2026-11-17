// A REQUEST SHE PASSED TO LEN, AS HER CARD KEEPS IT (spec local 2026-11-16-movil-es-tu-asistente, §5.4): the row of
// Len's turn and the project it went to. `ask_len` leaves it on its action, the turn's record keeps it, and the phone
// follows that row inside her chat. No Node imports: the phone reads it too.

export interface LenRequestRef {
  readonly filaId: string;
  readonly projectId: string;
}

const MAX = 100;
const ok = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= MAX;

/** What a stored or streamed action carries, checked; anything else is `null`. */
export function lenRequestRefFrom(raw: unknown): LenRequestRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { filaId, projectId } = raw as { filaId?: unknown; projectId?: unknown };
  return ok(filaId) && ok(projectId) ? { filaId, projectId } : null;
}
