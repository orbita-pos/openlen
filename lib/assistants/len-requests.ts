// HOW A REQUEST SHE PASSED TO LEN IS GOING (spec local 2026-11-16-movil-es-tu-asistente, §5.4, §5.8.5): what her card
// in the phone's chat shows. Len's row says it when it exists; before it does (still queued, or failed before opening
// it — no credits, waited too long), only her note knows. Pure; no Node imports: the phone reads the types.
import type { StoredChatTurn } from "@/lib/projects/types";

import { LOST_AFTER_MS, type AskLenNotice } from "./notices";

/** `stopped`: someone pressed ■ (Len's turn ended `cancelled`), so it neither finished nor failed. */
export type LenRequestStatus = "queued" | "running" | "done" | "stopped" | "failed" | "lost";

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
  /** Her owner's live turn on this row: «Parar». */
  readonly liveTurnoId: string | null;
  /** Some turn in this process runs this row (hers, or a member's): an «en curso» row without one was cut by a restart. */
  readonly rowAlive: boolean;
  readonly now: Date;
}): LenRequestView {
  const { filaId, note, turn, liveTurnoId } = o;
  const live = liveTurnoId ? { turnoId: liveTurnoId } : {};
  if (turn) {
    if (turn.enCurso) {
      // A row «en curso» that no turn runs was left by a restart (final review, I1): it ends here, never «running» forever.
      if (!liveTurnoId && !o.rowAlive) return { filaId, status: "failed", reason: "interrupted", turn };
      return { filaId, status: "running", turn, ...live };
    }
    // Stopped with ■, or cut halfway (a restart, a cap): never «Len terminó» (deferred minor of the final review).
    if (turn.endReason === "cancelled") return { filaId, status: "stopped", turn };
    if (turn.cortado) return { filaId, status: "failed", ...(turn.endReason ? { reason: turn.endReason } : {}), turn };
    return { filaId, status: turn.status === "error" ? "failed" : "done", turn };
  }
  if (liveTurnoId) return { filaId, status: "running", turnoId: liveTurnoId };
  if (note?.status === "failed") return { filaId, status: "failed", ...(note.reason ? { reason: note.reason } : {}) };
  if (note?.status === "done") return { filaId, status: "done" };
  if (note?.status === "queued") return o.now.getTime() - new Date(note.at).getTime() > LOST_AFTER_MS ? { filaId, status: "lost" } : { filaId, status: "queued" };
  // Every request writes its note before Len's turn is launched: no row, no note and no live turn means its note was
  // pruned, a week after she heard it (final review, I1). It is over — never «in line» again, never polled forever.
  return { filaId, status: "lost" };
}
