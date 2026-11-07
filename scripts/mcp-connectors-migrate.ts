// LEN'S MCP CONNECTORS (spec local 2026-11-06-conectores-mcp): personMcpConfigs (~/.len/mcp.json and its approvals),
// personCredentials (the keys, encrypted) and personMcpServerState (each server's last list and status). Additive and
// idempotent (IF NOT EXISTS).
//
// 🔴 MANDATORY in the same deploy as the code: without the tables, reading ~/.len/mcp.json fails soft (no connectors),
// and saving one fails.
//
// Run: npm run mcp-connectors:migrate

import { sql } from "drizzle-orm";

import { db } from "../lib/db";
import { CREATE_MCP_CONNECTORS } from "./mcp-connectors-migrate-sql";

async function main() {
  for (const statement of CREATE_MCP_CONNECTORS) await db.execute(sql.raw(statement));
  console.log("[mcp-connectors:migrate] personMcpConfigs, personCredentials and personMcpServerState ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[mcp-connectors:migrate] failed", err);
  process.exit(1);
});
