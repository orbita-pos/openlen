import { afterEach, describe, expect, it, vi } from "vitest";

import { postPublish } from "./publish-request";

afterEach(() => vi.unstubAllGlobals());

const reply = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("lo que contesta publicar", () => {
  it("200 → publicado", async () => {
    reply(200, { url: "https://t.openlen.app" });
    expect(await postPublish("p", { subdomain: "t" })).toEqual({ kind: "published", data: { url: "https://t.openlen.app" } });
  });
  it("428 → pedir confirmación con la huella", async () => {
    reply(428, { error: "confirmation_required", destructive: [{ kind: "drop_table", table: "v", count: 3 }], fingerprint: "f" });
    expect(await postPublish("p", { subdomain: "t" })).toEqual({ kind: "needs_confirmation", destructive: [{ kind: "drop_table", table: "v", count: 3 }], fingerprint: "f" });
  });
  it("422 migration_failed y migrations_diverged", async () => {
    reply(422, { error: "migration_failed", migration: "2_x", message: "boom" });
    expect(await postPublish("p", { subdomain: "t" })).toEqual({ kind: "migration_failed", migration: "2_x", message: "boom" });
    reply(422, { error: "migrations_diverged", versions: ["9"] });
    expect(await postPublish("p", { subdomain: "t" })).toEqual({ kind: "diverged", versions: ["9"] });
  });
  it("lo demás, con su código", async () => {
    reply(409, { error: "taken" });
    expect(await postPublish("p", { subdomain: "t" })).toEqual({ kind: "error", status: 409, error: "taken" });
  });
  // Len Watch (spec local 2026-10-30-len-watch, §5.5): the fix published from its branch isn't in the draft yet.
  it("428 len_watch_fix_pending → «Traer el arreglo» o «Publicar igual»", async () => {
    reply(428, { error: "len_watch_fix_pending", incidentId: "i1", branch: "len-watch/i1" });
    expect(await postPublish("p", { subdomain: "t" })).toEqual({ kind: "len_watch_fix_pending", incidentId: "i1", branch: "len-watch/i1" });
  });
});

describe("postPublish — Stripe (spec local 2026-10-21-stripe-integration)", () => {
  it("422 stripe_account_mismatch and 502 stripe_sync_failed", async () => {
    reply(422, { error: "stripe_account_mismatch" });
    expect(await postPublish("p1", { subdomain: "x" })).toEqual({ kind: "stripe_account_mismatch" });
    reply(502, { error: "stripe_sync_failed", message: "Too many requests" });
    expect(await postPublish("p1", { subdomain: "x" })).toEqual({ kind: "stripe_sync_failed", message: "Too many requests" });
  });
});

describe("postPublish — las Edge Functions", () => {
  it("428 de secretos, 422 de funciones que no compilan, y el despliegue o el empaquetador que fallan", async () => {
    reply(428, { error: "secrets_required", missing: ["STRIPE_SECRET_KEY"] });
    expect(await postPublish("p1", { subdomain: "x" })).toEqual({ kind: "secrets_required", missing: ["STRIPE_SECRET_KEY"] });
    reply(422, { error: "functions_do_not_compile", errors: ["/supabase/functions/a/index.ts:1:1 — x"] });
    expect(await postPublish("p1", { subdomain: "x" })).toEqual({ kind: "functions_do_not_compile", errors: ["/supabase/functions/a/index.ts:1:1 — x"] });
    reply(502, { error: "functions_deploy_failed" });
    expect(await postPublish("p1", { subdomain: "x" })).toEqual({ kind: "functions_failed" });
    reply(503, { error: "functions_bundler_unavailable" });
    expect(await postPublish("p1", { subdomain: "x" })).toEqual({ kind: "functions_failed" });
    reply(428, { error: "confirmation_required", destructive: [], fingerprint: "a".repeat(64) });
    expect((await postPublish("p1", { subdomain: "x" })).kind).toBe("needs_confirmation");
  });
});
