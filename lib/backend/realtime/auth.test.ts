// @vitest-environment node
//
// La puerta del socket, como su `UserSocket.connect` + `handle_error`, y su
// `confirm_token` para lo que dura un canal. Las claves `sb_…` las traduce aquí
// lo mismo que en /rest/v1 (en Supabase lo hace su pasarela).
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { hashSecretKey, newJwtSecret, newPublishableKey, newSecretKey, signJwt } from "../keys";
import { authorizeSocket, confirmToken } from "./auth";

const secretKey = newSecretKey();
const project = { publishableKey: newPublishableKey(), secretKeyHash: hashSecretKey(secretKey), jwtSecret: newJwtSecret() };

describe("authorizeSocket", () => {
  it("la clave publicable es anon, la secreta service_role", async () => {
    expect(await authorizeSocket(project.publishableKey, project)).toEqual({ ok: true, claims: { role: "anon" } });
    expect(await authorizeSocket(secretKey, project)).toEqual({ ok: true, claims: { role: "service_role" } });
  });

  it("un JWT de usuario del proyecto da sus claims", async () => {
    const jwt = await signJwt(project.jwtSecret, { sub: "u1", role: "authenticated" }, 3600);
    const r = await authorizeSocket(jwt, project);
    expect(r).toMatchObject({ ok: true, claims: { sub: "u1", role: "authenticated" } });
  });

  it("los errores del apretón, los de su handle_error", async () => {
    expect(await authorizeSocket(null, project)).toEqual({ ok: false, status: 401, error: "API key is missing" });
    expect(await authorizeSocket("sb_publishable_de_otro", project)).toEqual({ ok: false, status: 401, error: "The token provided is not a valid JWT" });
    expect(await authorizeSocket("no-es-un-jwt", project)).toEqual({ ok: false, status: 401, error: "The token provided is not a valid JWT" });
    const otro = await signJwt(newJwtSecret(), { role: "authenticated" }, 3600);
    expect(await authorizeSocket(otro, project)).toEqual({ ok: false, status: 401, error: "Failed to validate JWT signature" });
    const caducado = await signJwt(project.jwtSecret, { role: "authenticated" }, -10);
    expect(await authorizeSocket(caducado, project)).toEqual({ ok: false, status: 401, error: "Token has expired" });
    const sinRol = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(project.jwtSecret));
    expect(await authorizeSocket(sinRol, project)).toEqual({ ok: false, status: 401, error: "Fields `role` and `exp` are required in JWT" });
  });
});

describe("confirmToken", () => {
  it("un JWT vigente da sus claims y cuánto le queda, topado en una hora", async () => {
    const corto = await signJwt(project.jwtSecret, { sub: "u1", role: "authenticated" }, 120);
    const r = await confirmToken(corto, project);
    expect(r).toMatchObject({ ok: true, claims: { sub: "u1" } });
    expect((r as { msUntilRecheck: number }).msUntilRecheck).toBeGreaterThan(100_000);
    expect((r as { msUntilRecheck: number }).msUntilRecheck).toBeLessThanOrEqual(120_000);
    const largo = await signJwt(project.jwtSecret, { role: "authenticated" }, 86_400);
    expect(((await confirmToken(largo, project)) as { msUntilRecheck: number }).msUntilRecheck).toBe(3_600_000);
  });

  it("caducado: «Token has expired N seconds ago», como su authorize_conn", async () => {
    const caducado = await signJwt(project.jwtSecret, { role: "authenticated" }, -30);
    const r = await confirmToken(caducado, project);
    expect(r).toMatchObject({ ok: false, reason: "expired_token", message: expect.stringMatching(/^Token has expired \d+ seconds ago$/) });
  });

  it("una clave sb_ no caduca: sin nueva comprobación", async () => {
    expect(await confirmToken(project.publishableKey, project)).toEqual({ ok: true, claims: { role: "anon" }, msUntilRecheck: null });
  });
});
