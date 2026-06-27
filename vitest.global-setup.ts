// Load .env.local before any workers are forked so process.env.DATABASE_URL
// is available when lib/db/index.ts is evaluated inside test workers.
import { config } from "dotenv";
import { resolve } from "node:path";

export function setup() {
  config({ path: resolve(process.cwd(), ".env.local") });
}
