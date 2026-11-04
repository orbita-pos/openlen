// WHAT «HAZLO» DID, IN REGISTROS (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.3: «queda apuntado quién,
// cuándo, antes y después: en la tarjeta y en Registros»). The card keeps it a week in the chat; the task's records keep
// it with the rest of what the task did — what changed or who was written to, and who pressed.
import "server-only";

import type { EventTaskCardRow } from "../store";

export type ActionLog = (card: EventTaskCardRow, kind: "applied" | "sent", what: string) => Promise<void>;

export async function defaultActionLog(): Promise<ActionLog> {
  const [store, { db, schema }, { eq }] = await Promise.all([import("../store"), import("@/lib/db"), import("drizzle-orm")]);
  return async (card, kind, what) => {
    const [u] = card.decidedBy
      ? await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, card.decidedBy)).limit(1)
      : [];
    const who = u?.name || u?.email || null;
    await store.writeRecord({ taskId: card.taskId, projectId: card.projectId, kind, reason: who ? `${what} · ${who}` : what, at: new Date() });
  };
}
