// Grant a user a credit balance. One-off admin operation.
//
// Sets the balance AND resets creditsRefreshedAt to now — otherwise the lazy
// 30-day refill in getCreditState would clobber the grant back to the plan
// allotment on the next read.
//
// Usage:
//   npm run users:grant-credits -- <email> [amount]
//
//   npm run users:grant-credits -- info@jesusbr.com 1000
//   npm run users:grant-credits -- info@jesusbr.com         # defaults to 1000

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

async function main(): Promise<void> {
  const email = process.argv[2]?.toLowerCase()?.trim();
  const amount = process.argv[3] ? Number(process.argv[3]) : 1000;

  if (!email) {
    // eslint-disable-next-line no-console
    console.error("Usage: tsx scripts/users/grant-credits.ts <email> [amount]");
    process.exit(1);
  }
  if (!Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount)) {
    // eslint-disable-next-line no-console
    console.error(`Invalid amount "${process.argv[3]}". Must be a non-negative integer.`);
    process.exit(1);
  }

  const before = await db
    .select({
      id: schema.users.id,
      plan: schema.users.plan,
      credits: schema.users.credits,
    })
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
    .set({ credits: amount, creditsRefreshedAt: new Date() })
    .where(eq(schema.users.email, email));

  // eslint-disable-next-line no-console
  console.log(
    `${email} [${before[0].plan}]: ${before[0].credits} -> ${amount} credits (refill clock reset)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
