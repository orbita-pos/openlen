// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isSameOriginRequest } from "./same-origin";

const env = { NEXT_PUBLIC_SITE_URL: "https://openlen.com" };
const req = (headers: Record<string, string>) => new Request("http://interno:3000/api/x", { method: "POST", headers });

describe("¿viene de nuestra web?", () => {
  it("de openlen.com, o del mismo host que la petición (en local): sí", () => {
    expect(isSameOriginRequest(req({ origin: "https://openlen.com" }), env)).toBe(true);
    expect(isSameOriginRequest(req({ origin: "http://localhost:3007", "x-forwarded-host": "localhost:3007" }), env)).toBe(true);
  });
  it("🔴 de otra web, de una página publicada o con Origin null: no", () => {
    expect(isSameOriginRequest(req({ origin: "https://evil.example", "x-forwarded-host": "openlen.com" }), env)).toBe(false);
    expect(isSameOriginRequest(req({ origin: "https://cafe.openlen.app", "x-forwarded-host": "openlen.com" }), env)).toBe(false);
    expect(isSameOriginRequest(req({ origin: "null" }), env)).toBe(false);
  });
  it("sin Origin decide Sec-Fetch-Site; sin ninguno no es un navegador (no lleva la cookie de nadie): pasa", () => {
    expect(isSameOriginRequest(req({ "sec-fetch-site": "cross-site" }), env)).toBe(false);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-site" }), env)).toBe(false);
    expect(isSameOriginRequest(req({ "sec-fetch-site": "same-origin" }), env)).toBe(true);
    expect(isSameOriginRequest(req({}), env)).toBe(true);
  });
});
