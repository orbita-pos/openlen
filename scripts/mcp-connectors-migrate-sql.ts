// The SQL of `npm run mcp-connectors:migrate`, apart so the PGlite tests create the very same tables
// (lib/mcp-connectors/*.pglite.test.ts). Keep in step with lib/db/schema.ts (`personMcpConfigs`, `personCredentials`,
// `personMcpServerState`). Spec local 2026-11-06-conectores-mcp.
export const CREATE_MCP_CONNECTORS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS "personMcpConfigs" (
    "personId" text PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
    "text" text NOT NULL,
    "approved" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "version" integer NOT NULL DEFAULT 0,
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS "personCredentials" (
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "value" text NOT NULL,
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("personId", "name")
  );`,
  `CREATE TABLE IF NOT EXISTS "personMcpServerState" (
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "serverName" text NOT NULL,
    "fingerprint" text NOT NULL,
    "tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "instructions" text NOT NULL DEFAULT '',
    "hasResources" boolean NOT NULL DEFAULT false,
    "listedAt" timestamp with time zone,
    "status" text NOT NULL,
    "error" text,
    "stale" boolean NOT NULL DEFAULT false,
    "failures" integer NOT NULL DEFAULT 0,
    "attemptedAt" timestamp with time zone,
    PRIMARY KEY ("personId", "serverName")
  );`,
  // DeepSeek's reconnect budget (06/11, after the first version of this table): additive.
  `ALTER TABLE "personMcpServerState" ADD COLUMN IF NOT EXISTS "failures" integer NOT NULL DEFAULT 0;`,
  `ALTER TABLE "personMcpServerState" ADD COLUMN IF NOT EXISTS "attemptedAt" timestamp with time zone;`,
];
