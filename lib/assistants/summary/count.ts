// WHAT HAPPENED YESTERDAY, FOR HER MORNING SUMMARY (spec local 2026-11-06-asistente-propio, §6.9, §4.6; phase 4D):
// counts, no model, no credit — «ayer hablé con 14 personas, 3 dejaron su número». The people she talked with (her
// visits with a line in the day), the contacts her bubble's form left in her projects (its message starts with
// «[Asistente]», lib/publish/assistant-widget.ts — there is no other mark of a contact: `note_request` scrubs them), and
// what she noted she couldn't do (assistantRequests).
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";

export { dayBounds } from "./day";

export interface SummaryCounts {
  readonly talkedWith: number;
  readonly contacts: number;
  readonly requests: number;
}

export async function countYesterday(assistantId: string, projectIds: readonly string[], start: Date, end: Date): Promise<SummaryCounts> {
  const v = schema.assistantVisits;
  const visits = await db.select({ lines: v.lines }).from(v).where(and(eq(v.assistantId, assistantId), gte(v.lastAt, start)));
  const inDay = (at: string) => {
    const t = Date.parse(at);
    return t >= start.getTime() && t < end.getTime();
  };
  const talkedWith = visits.filter((x) => (x.lines ?? []).some((l) => typeof l?.at === "string" && inDay(l.at))).length;

  const f = schema.formSubmissions;
  const [forms] = projectIds.length
    ? await db
        .select({ n: count() })
        .from(f)
        .where(and(inArray(f.projectId, [...projectIds]), gte(f.createdAt, start), lt(f.createdAt, end), sql`${f.data}->>'mensaje' like '[Asistente]%'`))
    : [{ n: 0 }];

  const r = schema.assistantRequests;
  const [requests] = await db
    .select({ n: count() })
    .from(r)
    .where(and(eq(r.assistantId, assistantId), gte(r.at, start), lt(r.at, end)));

  return { talkedWith, contacts: Number(forms?.n ?? 0), requests: Number(requests?.n ?? 0) };
}
