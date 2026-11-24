// THE CALENDAR SERVER'S PROTECTED RESOURCE METADATA (RFC 9728; spec local 2026-11-24-servidor-de-google-calendar, §5.1).
// Its authorization server is Google: the connector signs the person in there, with OpenLen's own Google client.
import { GCAL_SCOPES, gcalResourceUrl } from "@/lib/google-calendar-mcp/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      resource: gcalResourceUrl(),
      authorization_servers: ["https://accounts.google.com"],
      scopes_supported: [...GCAL_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "OpenLen Google Calendar",
    }),
    {
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=300",
        "access-control-allow-origin": "*",
      },
    },
  );
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "*" },
  });
}
