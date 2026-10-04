// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  hashSecretKey,
  newJwtSecret,
  newProjectRef,
  newPublishableKey,
  newSecretKey,
  signJwt,
  verifyJwt,
} from "./keys";

describe("las claves de un proyecto, con la forma de Supabase", () => {
  it("el ref son 20 letras minúsculas, como los de Supabase", () => {
    const refs = new Set(Array.from({ length: 50 }, () => newProjectRef()));
    expect(refs.size).toBe(50);
    for (const r of refs) expect(r).toMatch(/^[a-z]{20}$/);
  });

  it("las claves llevan los prefijos que supabase-js reconoce", () => {
    expect(newPublishableKey()).toMatch(/^sb_publishable_[A-Za-z0-9]{32}$/);
    expect(newSecretKey()).toMatch(/^sb_secret_[A-Za-z0-9]{32}$/);
    expect(newPublishableKey()).not.toBe(newPublishableKey());
  });

  it("la secreta se guarda por su hash", () => {
    const k = newSecretKey();
    expect(hashSecretKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecretKey(k)).toBe(hashSecretKey(k));
    expect(hashSecretKey(k)).not.toBe(hashSecretKey(newSecretKey()));
  });
});

describe("el JWT (HS256 con el secreto del proyecto)", () => {
  const secreto = newJwtSecret();

  it("lo que se firma se verifica, con sus claims", async () => {
    const t = await signJwt(secreto, { sub: "u1", role: "authenticated", aud: "authenticated" }, 3600);
    const v = await verifyJwt(secreto, t);
    expect(v).toMatchObject({ ok: true, claims: { sub: "u1", role: "authenticated", aud: "authenticated" } });
    if (v.ok) expect(typeof v.claims.exp).toBe("number");
  });

  it("con otro secreto, no vale (otro proyecto)", async () => {
    const t = await signJwt(newJwtSecret(), { sub: "u1", role: "authenticated" }, 3600);
    expect(await verifyJwt(secreto, t)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("caducado, no vale", async () => {
    const t = await signJwt(secreto, { sub: "u1", role: "authenticated" }, -10);
    expect(await verifyJwt(secreto, t)).toEqual({ ok: false, reason: "expired" });
  });

  it("algo que no es un JWT, no vale", async () => {
    expect(await verifyJwt(secreto, "hola")).toEqual({ ok: false, reason: "malformed" });
  });

  it("BRAZO DE CONTROL: un JWT sin firma (alg none) no vale", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const sinFirma = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: "u1", role: "service_role", exp: 9999999999 })}.`;
    expect((await verifyJwt(secreto, sinFirma)).ok).toBe(false);
  });
});
