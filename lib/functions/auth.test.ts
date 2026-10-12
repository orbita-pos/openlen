// @vitest-environment node
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { hashSecretKey } from "@/lib/backend/keys";

import { checkFunctionAuth } from "./auth";

const SECRETO = "s".repeat(48);
const O = { verifyJwt: true, publishableKey: "sb_publishable_abc", secretKeyHash: hashSecretKey("sb_secret_xyz"), jwtSecret: async () => SECRETO };
const jwt = (secret: string) => new SignJWT({ role: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(secret));
const req = (headers: Record<string, string>, method = "POST") => new Request("https://x.openlen.app/functions/v1/a", { method, headers });

describe("checkFunctionAuth", () => {
  it("pasa: la clave publicable o la secreta como Bearer, un JWT del entorno, o sólo la apikey", async () => {
    expect(await checkFunctionAuth(req({ authorization: "Bearer sb_publishable_abc" }), O)).toEqual({ ok: true });
    expect(await checkFunctionAuth(req({ authorization: "Bearer sb_secret_xyz" }), O)).toEqual({ ok: true });
    expect(await checkFunctionAuth(req({ authorization: `Bearer ${await jwt(SECRETO)}` }), O)).toEqual({ ok: true });
    expect(await checkFunctionAuth(req({ apikey: "sb_publishable_abc" }), O)).toEqual({ ok: true });
  });

  it("no pasa: sin cabeceras, otro formato, un JWT del OTRO entorno", async () => {
    expect(await checkFunctionAuth(req({}), O)).toEqual({ ok: false, code: "UNAUTHORIZED_NO_AUTH_HEADER" });
    expect(await checkFunctionAuth(req({ authorization: "Basic abc" }), O)).toEqual({ ok: false, code: "UNAUTHORIZED_INVALID_JWT_FORMAT" });
    expect(await checkFunctionAuth(req({ authorization: "Bearer nada" }), O)).toEqual({ ok: false, code: "UNAUTHORIZED_INVALID_JWT_FORMAT" });
    expect(await checkFunctionAuth(req({ authorization: `Bearer ${await jwt("o".repeat(48))}` }), O)).toEqual({ ok: false, code: "UNAUTHORIZED_LEGACY_JWT" });
    expect(await checkFunctionAuth(req({ apikey: "otra" }), O)).toEqual({ ok: false, code: "UNAUTHORIZED_NO_AUTH_HEADER" });
  });

  it("verify_jwt = false y OPTIONS pasan sin nada", async () => {
    expect(await checkFunctionAuth(req({}), { ...O, verifyJwt: false })).toEqual({ ok: true });
    expect(await checkFunctionAuth(req({}, "OPTIONS"), O)).toEqual({ ok: true });
  });
});
