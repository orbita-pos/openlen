// La tabla de los recordatorios de renovación ya mandados (idempotente). Como
// los demás *-migrate: en vez de db:push, para no tocar otra deriva pendiente.
// Mantener en sintonía con lib/db/schema.ts (`renewalReminders`).
// Run: npm run renewal-reminders:migrate

import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS "renewalReminders" (
    "userId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "periodEnd" timestamp NOT NULL,
    "sentAt" timestamp NOT NULL DEFAULT now(),
    PRIMARY KEY ("userId", "periodEnd")
  );`);
  console.log("tabla renewalReminders lista.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
