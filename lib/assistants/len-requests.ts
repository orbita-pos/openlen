// HOW A REQUEST SHE PASSED TO LEN IS GOING (spec local 2026-11-16-movil-es-tu-asistente, §5.4, §5.8.5): what her card
// in the phone's chat shows. Len's row says it when it exists; before it does (still queued, or failed before opening
// it — no credits, waited too long), only her note knows. Pure; no Node imports: the phone reads the types.
import type { StoredChatTurn } from "@/lib/projects/types";

import { LOST_AFTER_MS, type AskLenNotice } from "./notices";

export type LenRequestStatus = "queued" | "running" | "done" | "failed" | "lost";

export interface LenRequestView {
  readonly filaId: string;
  readonly status: LenRequestStatus;
  /** Why it failed, when only her note knows (`no_credits`, …). */
  readonly reason?: string;
  /** Len's row, once it exists: his steps, what he said. */
  readonly turn?: StoredChatTurn;
  /** The live turn, for «Parar». */
  readonly turnoId?: string;
}

export function lenRequestView(o: {
  readonly filaId: string;
  readonly note: AskLenNotice | null;
  readonly turn: StoredChatTurn | null;
  readonly liveTurnoId: string | null;
  readonly now: Date;
}): LenRequestView {
  const { filaId, note, turn, liveTurnoId } = o;
  const live = liveTurnoId ? { turnoId: liveTurnoId } : {};
  if (turn) {
    if (turn.enCurso) return { filaId, status: "running", turn, ...live };
    return { filaId, status: turn.status === "error" ? "failed" : "done", turn };
  }
  if (liveTurnoId) return { filaId, status: "running", turnoId: liveTurnoId };
  if (note?.status === "failed") return { filaId, status: "failed", ...(note.reason ? { reason: note.reason } : {}) };
  if (note?.status === "queued" && o.now.getTime() - new Date(note.at).getTime() > LOST_AFTER_MS) return { filaId, status: "lost" };
  return { filaId, status: "queued" };
}
