// @vitest-environment node
import { describe, expect, it } from "vitest";

import { memorySecretStore, secretNamesOf } from "./secret-store";
import { secretDigest } from "./secrets";

describe("memorySecretStore", () => {
  it("guarda por entorno, lista SIN valores, da los valores de un entorno, sustituye y quita", async () => {
    const s = memorySecretStore(() => new Date("2026-10-12T10:00:00Z"));
    await s.set("p1", "draft", { STRIPE_SECRET_KEY: "sk_test_1", B: "b" }, "u1");
    await s.set("p1", "live", { STRIPE_SECRET_KEY: "sk_live_1" }, "u2");
    await s.set("p2", "draft", { OTRO: "x" }, null);
    const filas = await s.list("p1");
    expect(filas.map((f) => `${f.environment}:${f.name}`)).toEqual(["draft:B", "draft:STRIPE_SECRET_KEY", "live:STRIPE_SECRET_KEY"]);
    expect(filas[1]).toEqual({ environment: "draft", name: "STRIPE_SECRET_KEY", digest: secretDigest("sk_test_1"), updatedAt: new Date("2026-10-12T10:00:00Z"), updatedBy: "u1" });
    expect(JSON.stringify(filas)).not.toContain("sk_test_1");
    expect(await s.values("p1", "live")).toEqual({ STRIPE_SECRET_KEY: "sk_live_1" });
    await s.set("p1", "draft", { STRIPE_SECRET_KEY: "sk_test_2" }, "u1");
    expect((await s.values("p1", "draft")).STRIPE_SECRET_KEY).toBe("sk_test_2");
    expect(await s.unset("p1", "draft", ["B", "NO_EXISTE"])).toEqual(["B"]);
    expect(secretNamesOf(await s.list("p1"))).toEqual({ draft: ["STRIPE_SECRET_KEY"], live: ["STRIPE_SECRET_KEY"] });
  });
});
