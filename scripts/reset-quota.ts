// scripts/reset-quota.ts
//
// Resets AI usage limits for local testing:
//  - clears the hourly rate-limit counters (rateLimitEvents rows)
//  - refills the credit balance to the plan allotment
//
// Usage:
//   npm run reset-quota                              # every user
//   npm run reset-quota -- jose12cheti12@gmail.com   # only that user

import { eq, inArray, like, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CREDITS_BY_PLAN } from "@/lib/credits";

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();
  const now = new Date();

  if (email) {
    const rows = await db
      .select({
        id: schema.users.id,
        email: schema.users.email,
        plan: schema.users.plan,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    const user = rows[0];
    if (!user) {
      console.error(`[reset-quota] no user found with email "${email}"`);
      process.exit(1);
    }
    const allotment = CREDITS_BY_PLAN[user.plan === "pro" ? "pro" : "free"];
    const cleared = await db
      .delete(schema.rateLimitEvents)
      .where(
        inArray(schema.rateLimitEvents.key, [
          `user:${user.id}:generate`,
          `user:${user.id}:regen`,
        ]),
      )
      .returning({ id: schema.rateLimitEvents.id });
    await db
      .update(schema.users)
      .set({ credits: allotment, creditsRefreshedAt: now })
      .where(eq(schema.users.id, user.id));
    console.log(
      `[reset-quota] ${user.email}: cleared ${cleared.length} rate-limit row(s), credits set to ${allotment}`,
    );
  } else {
    const cleared = await db
      .delete(schema.rateLimitEvents)
      .where(
        or(
          like(schema.rateLimitEvents.key, "user:%:generate"),
          like(schema.rateLimitEvents.key, "user:%:regen"),
        ),
      )
      .returning({ id: schema.rateLimitEvents.id });
    await db
      .update(schema.users)
      .set({ credits: CREDITS_BY_PLAN.free, creditsRefreshedAt: now })
      .where(eq(schema.users.plan, "free"));
    await db
      .update(schema.users)
      .set({ credits: CREDITS_BY_PLAN.pro, creditsRefreshedAt: now })
      .where(eq(schema.users.plan, "pro"));
    console.log(
      `[reset-quota] all users: cleared ${cleared.length} rate-limit row(s), credits refilled to plan allotment`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reset-quota] failed:", err);
    process.exit(1);
  });
