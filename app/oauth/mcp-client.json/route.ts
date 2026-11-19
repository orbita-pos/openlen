// OPENLEN'S CLIENT ID METADATA DOCUMENT (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2 step 4): a public JSON
// document at `/oauth/mcp-client.json` whose `client_id` is its own URL, for authorization servers that advertise
// `client_id_metadata_document_supported`.
import { siteOrigin } from "@/lib/mcp/config";
import { clientMetadata, clientMetadataUrl } from "@/lib/mcp-connectors/oauth/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const siteUrl = siteOrigin();
  const body = { client_id: clientMetadataUrl(siteUrl), ...clientMetadata(siteUrl) };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
  });
}
