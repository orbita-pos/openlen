// The SQL of `npm run mcp-connectors:migrate`, apart so the PGlite tests create the very same tables
// (lib/mcp-connectors/*.pglite.test.ts). Keep in step with lib/db/schema.ts (`personMcpConfigs`, `personCredentials`,
// `personMcpServerState`, `personMcpOAuth`, `personMcpOAuthFlows`). Spec local 2026-11-06-conectores-mcp and
// 2026-11-17-oauth-de-conectores-mcp.
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
  // OAuth of the connectors (spec local 2026-11-17-oauth-de-conectores-mcp, §5.3, §5.4): additive.
  `CREATE TABLE IF NOT EXISTS "personMcpOAuth" (
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "serverName" text NOT NULL,
    "serverUrl" text NOT NULL,
    "issuer" text NOT NULL,
    "clientInfo" text NOT NULL,
    "tokens" text,
    "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY ("personId", "serverName")
  );`,
  `CREATE TABLE IF NOT EXISTS "personMcpOAuthFlows" (
    "state" text PRIMARY KEY,
    "personId" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "serverName" text NOT NULL,
    "fingerprint" text NOT NULL,
    "issuer" text NOT NULL,
    "codeVerifier" text NOT NULL,
    "scope" text,
    "expiresAt" timestamp with time zone NOT NULL,
    "usedAt" timestamp with time zone
  );`,
  `ALTER TABLE "personMcpServerState" ADD COLUMN IF NOT EXISTS "authIssuer" text;`,
  `ALTER TABLE "personMcpServerState" ADD COLUMN IF NOT EXISTS "authReason" text;`,
  `ALTER TABLE "personMcpServerState" ADD COLUMN IF NOT EXISTS "authScope" text;`,
  // A connection is bound to the entry it was signed in with (review fix, 19/11): additive. A row without it is used by no entry.
  `ALTER TABLE "personMcpOAuth" ADD COLUMN IF NOT EXISTS "fingerprint" text;`,
];
