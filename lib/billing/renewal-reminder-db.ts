// La base del recordatorio de renovación: quién paga, y para qué renovación
// se le avisó ya. La lógica está en ./renewal-reminder.ts.

import { and, inArray, isNotNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { planFromDb } from "@/lib/plan";
import type { PaidUser } from "./renewal-reminder";

/** Quien tiene un plan de pago y una suscripción de Polar, con la última
 *  renovación de la que ya se le avisó. */
export async function listPaidUsers(): Promise<PaidUser[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      plan: schema.users.plan,
      subscriptionId: schema.users.polarSubscriptionId,
    })
    .from(schema.users)
    .where(and(inArray(schema.users.plan, ["pro", "max"]), isNotNull(schema.users.polarSubscriptionId)));
  if (rows.length === 0) return [];

  const avisos = await db
    .select({ userId: schema.renewalReminders.userId, periodEnd: schema.renewalReminders.periodEnd })
    .from(schema.renewalReminders)
    .where(inArray(schema.renewalReminders.userId, rows.map((r) => r.id)));
  const ultimo = new Map<string, Date>();
  for (const a of avisos) {
    const prev = ultimo.get(a.userId);
    if (!prev || a.periodEnd > prev) ultimo.set(a.userId, a.periodEnd);
  }

  const out: PaidUser[] = [];
  for (const r of rows) {
    const plan = planFromDb(r.plan);
    if (plan === "free" || !r.subscriptionId) continue;
    out.push({ id: r.id, email: r.email, plan, subscriptionId: r.subscriptionId, sentFor: ultimo.get(r.id) ?? null });
  }
  return out;
}

export async function markReminderSent(userId: string, periodEnd: Date): Promise<void> {
  await db.insert(schema.renewalReminders).values({ userId, periodEnd }).onConflictDoNothing();
}
