import { config as loadEnv } from "dotenv";
import type { Config } from "drizzle-kit";

// drizzle-kit doesn't read .env.local automatically (only .env). Load it
// explicitly so `npm run db:push` etc. work without extra wrappers.
loadEnv({ path: ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
} satisfies Config;
