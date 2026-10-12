// @vitest-environment node
import { describe, expect, it } from "vitest";
import { fetchClientMetadataDocument, isCimdClientId } from "./cimd";

const URL_ = "https://claude.ai/oauth/claude-code-client-metadata";

describe("los documentos CIMD", () => {
  it("un client_id CIMD es una URL https con ruta", () => {
    expect(isCimdClientId(URL_)).toBe(true);
    expect(isCimdClientId("olc_abc")).toBe(false);
    expect(isCimdClientId("http://claude.ai/x")).toBe(false);
  });

  it("vale si su client_id es su URL y trae redirect_uris aceptables", async () => {
    const r = await fetchClientMetadataDocument(URL_, async () => ({ client_id: URL_, client_name: "Claude Code", redirect_uris: ["http://localhost/callback"] }));
    expect(r).toMatchObject({ ok: true, doc: { client_name: "Claude Code" } });
  });

  it("🔴 un documento que dice ser otro cliente no vale", async () => {
    const r = await fetchClientMetadataDocument(URL_, async () => ({ client_id: "https://evil.com/doc", redirect_uris: ["https://evil.com/cb"] }));
    expect(r.ok).toBe(false);
  });

  it("sin redirect_uris, o con alguno inaceptable, no vale", async () => {
    expect((await fetchClientMetadataDocument(URL_, async () => ({ client_id: URL_ }))).ok).toBe(false);
    expect((await fetchClientMetadataDocument(URL_, async () => ({ client_id: URL_, redirect_uris: ["http://evil.com/cb"] }))).ok).toBe(false);
  });

  it("si la descarga falla, no vale (y no lanza)", async () => {
    expect((await fetchClientMetadataDocument(URL_, async () => { throw new Error("timeout"); })).ok).toBe(false);
  });
});
