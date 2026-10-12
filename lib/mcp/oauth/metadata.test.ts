// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authorizationServerMetadata, oauthEndpoints } from "./metadata";

const env = { MCP_ISSUER: "https://openlen.com" };

describe("la metadata del servidor de autorización (RFC 8414)", () => {
  it("los endpoints viven en el MISMO origen que el issuer (Codex lo exige)", () => {
    const e = oauthEndpoints(env);
    for (const url of Object.values(e)) expect(new URL(url).origin).toBe("https://openlen.com");
  });

  it("dice lo que hace falta para que funcione en todos los clientes", () => {
    const m = authorizationServerMetadata(env);
    expect(m).toMatchObject({
      issuer: "https://openlen.com",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(m.scopes_supported).toEqual(["projects:read", "projects:write", "publish", "offline_access"]);
    expect(m.registration_endpoint).toBe("https://openlen.com/api/oauth/register");
  });
});
