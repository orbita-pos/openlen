// LOS CLIENTES OAUTH: DCR (registro abierto, `olc_…`) y CIMD (el id es la URL
// del documento; se guarda 24 h y se vuelve a descargar pasado ese tiempo).
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { fetchClientMetadataDocument, isCimdClientId, type FetchJson } from "./cimd";
import { isAcceptableRedirectUri } from "./redirects";

export interface OauthClient {
  id: string;
  kind: "dcr" | "cimd";
  name: string;
  redirectUris: string[];
}

const CIMD_TTL_MS = 24 * 60 * 60 * 1000;

function toClient(row: typeof schema.mcpOauthClients.$inferSelect): OauthClient {
  return { id: row.id, kind: row.kind, name: row.name, redirectUris: row.redirectUris };
}

export async function registerDcrClient(
  input: unknown,
): Promise<{ ok: true; client: OauthClient } | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string }> {
  const b = (input ?? {}) as { client_name?: unknown; redirect_uris?: unknown };
  if (!Array.isArray(b.redirect_uris) || b.redirect_uris.length === 0 || b.redirect_uris.length > 10) {
    return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris must be a list of 1 to 10 URIs." };
  }
  const uris = b.redirect_uris.filter((u): u is string => typeof u === "string");
  if (uris.length !== b.redirect_uris.length || !uris.every(isAcceptableRedirectUri)) {
    return { ok: false, error: "invalid_redirect_uri", description: "Each redirect_uri must be https, http to localhost, or a private-use scheme." };
  }
  const name =
    typeof b.client_name === "string" && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : new URL(uris[0]!).host || "MCP client";
  const id = `olc_${crypto.randomBytes(18).toString("base64url")}`;
  await db.insert(schema.mcpOauthClients).values({ id, kind: "dcr", name, redirectUris: uris });
  return { ok: true, client: { id, kind: "dcr", name, redirectUris: uris } };
}

export async function resolveClient(clientId: string, fetchJson?: FetchJson): Promise<OauthClient | null> {
  const [row] = await db.select().from(schema.mcpOauthClients).where(eq(schema.mcpOauthClients.id, clientId)).limit(1);
  const fresh = row && (row.kind === "dcr" || (row.fetchedAt && Date.now() - row.fetchedAt.getTime() < CIMD_TTL_MS));
  if (row && fresh) return toClient(row);
  if (!isCimdClientId(clientId)) return row ? toClient(row) : null;
  const r = await fetchClientMetadataDocument(clientId, fetchJson);
  if (!r.ok) {
    // Sin esto, un CIMD que no baja es un «invalid_client» mudo en /authorize.
    console.warn(`[mcp-oauth] CIMD ${clientId}: ${r.reason}`);
    return null;
  }
  const name = r.doc.client_name ?? new URL(clientId).host;
  await db
    .insert(schema.mcpOauthClients)
    .values({ id: clientId, kind: "cimd", name, redirectUris: r.doc.redirect_uris, fetchedAt: new Date() })
    .onConflictDoUpdate({ target: schema.mcpOauthClients.id, set: { name, redirectUris: r.doc.redirect_uris, fetchedAt: new Date() } });
  return { id: clientId, kind: "cimd", name, redirectUris: r.doc.redirect_uris };
}
