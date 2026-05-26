// Bump (or downgrade) a user's plan. One-off admin operation.
//
// Usage:
//   npm run users:set-plan -- <email> <plan>
//
//   npm run users:set-plan -- info@jesusbr.com pro
//   npm run users:set-plan -- spammer@example.com free

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const email = process.argv[2]?.toLowerCase()?.trim();
  const plan = process.argv[3]?.toLowerCase()?.trim();

  if (!email || !plan) {
    // eslint-disable-next-line no-console
    console.error("Usage: tsx scripts/users/set-plan.ts <email> <pro|free>");
    process.exit(1);
  }
  if (plan !== "free" && plan !== "pro") {
    // eslint-disable-next-line no-console
    console.error(`Invalid plan "${plan}". Must be "free" or "pro".`);
    process.exit(1);
  }

  const before = await db
    .select({ id: schema.users.id, plan: schema.users.plan })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  if (!before[0]) {
    // eslint-disable-next-line no-console
    console.error(`No user with email "${email}".`);
    process.exit(1);
  }

  await db
    .update(schema.users)
    .set({ plan })
    .where(eq(schema.users.email, email));

  // eslint-disable-next-line no-console
  console.log(`${email}: ${before[0].plan} -> ${plan}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
