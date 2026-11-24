// THE CALENDAR SERVER OVER HTTP (spec local 2026-11-24-servidor-de-google-calendar, §5.1, §5.2, §5.7): a stateless Web
// handler like OpenLen's own MCP server (lib/mcp/server.ts). Before mcp-handler sees a request: off → 503; a token Google
// says lacks a scope → 403 `insufficient_scope` (the connector puts the server in needs-auth/scope); a good token past its
// 60 calls a minute → 429; Google unable to check it (tokeninfo down, 5xx, 429) → 503. A missing or bad token is
// withMcpAuth's 401 with the link to the metadata.
import { createHash } from "node:crypto";

import { createMcpHandler, withMcpAuth } from "mcp-handler";

import { consumeToken, RATE_LIMITS } from "@/lib/rate-limit";

import { gcalEnabled, gcalResourceMetadataUrl, gcalResourceUrl } from "./config";
import { checkGoogleToken, type TokenDeps } from "./token";
import { registerGcalTools } from "./tools";

const SERVER_INFO = { name: "openlen-google-calendar", title: "OpenLen Google Calendar", version: "1.0.0" } as const;

function bearerOf(req: Request): string | undefined {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  return m?.[1]?.trim() || undefined;
}

const plain = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json", ...headers } });

export function buildGcalMcpHandler(d: TokenDeps): (req: Request) => Promise<Response> {
  const handler = createMcpHandler((server) => registerGcalTools(server, { fetch: d.fetch }), { serverInfo: SERVER_INFO });
  const metadata = new URL(gcalResourceMetadataUrl());
  const authed = withMcpAuth(
    handler,
    async (_req, bearer) => {
      const c = await checkGoogleToken(bearer, d);
      return c.ok ? c.authInfo : undefined;
    },
    { required: true, resourceUrl: new URL(gcalResourceUrl()).origin, resourceMetadataPath: metadata.pathname },
  );
  return async (req) => {
    if (!gcalEnabled()) return plain(503, "OpenLen's Google Calendar server is off");
    const bearer = bearerOf(req);
    if (bearer) {
      const c = await checkGoogleToken(bearer, d);
      // Google couldn't vouch for the token either way: a failure the connector retries, not a sign-in.
      if (!c.ok && c.status === 503) return plain(503, "Google couldn't check the sign-in right now; try again", { "retry-after": "30" });
      if (!c.ok && c.status === 403) {
        return plain(403, "insufficient_scope", {
          "www-authenticate": `Bearer error="insufficient_scope", scope="${c.missing.join(" ")}", resource_metadata="${metadata.toString()}"`,
        });
      }
      if (c.ok) {
        const key = `gcal:${createHash("sha256").update(bearer).digest("hex").slice(0, 16)}`;
        const r = consumeToken(key, RATE_LIMITS.gcalMcp);
        if (!r.allowed) return plain(429, "too many calls", { "retry-after": String(Math.ceil(r.retryAfterMs / 1000)) });
      }
    }
    return authed(req);
  };
}
