// What scripts/email-migrate.ts runs on a table that already exists, apart so PGlite tests run the same SQL.

/** The owner's reply from an event task's card is its own kind (spec local 2026-11-04-hazlo, §7.6.6). Postgres named
 * the inline CHECK `emailMessages_kind_check`; dropping and adding it again is idempotent. */
export const EMAIL_MESSAGES_KIND_CHECK: readonly string[] = [
  `ALTER TABLE "emailMessages" DROP CONSTRAINT IF EXISTS "emailMessages_kind_check"`,
  `ALTER TABLE "emailMessages" ADD CONSTRAINT "emailMessages_kind_check" CHECK ("kind" IN ('app', 'auth', 'form', 'reply'))`,
];
