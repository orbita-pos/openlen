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
});
