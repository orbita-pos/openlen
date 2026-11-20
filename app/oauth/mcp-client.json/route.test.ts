// @vitest-environment node
//
// OpenLen's Client ID Metadata Document (spec local 2026-11-17-oauth-de-conectores-mcp, §5.2 step 4; final review M4): an
// authorization server that supports CIMD fetches this URL and takes it as the client's id, so the document's
// `client_id` must be exactly its own URL, the consent screen says «OpenLen», and the one return address is the callback.
import { afterEach, describe, expect, it, vi } from "vitest";

const { GET } = await import("./route");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /oauth/mcp-client.json", () => {
  it("🔴 names its own URL as client_id, «OpenLen» as client_name, and is cached publicly for an hour", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
    const res = GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(await res.json()).toEqual({
      client_id: "https://openlen.com/oauth/mcp-client.json",
      client_name: "OpenLen",
      redirect_uris: ["https://openlen.com/api/mcp-connectors/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
  });

  it("the id is the URL it is served at, whatever the site URL's trailing slash, and openlen.com when none is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.openlen.com/");
    expect((await GET().json()).client_id).toBe("https://staging.openlen.com/oauth/mcp-client.json");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const doc = await GET().json();
    expect(doc.client_id).toBe("https://openlen.com/oauth/mcp-client.json");
    expect(doc.redirect_uris).toEqual(["https://openlen.com/api/mcp-connectors/oauth/callback"]);
  });
});
