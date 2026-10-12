// @vitest-environment node
//
// Guardar y quitar secretos (spec local 2026-10-11, Parte 4): lo mismo para la
// tarjeta (la ruta) y para `supabase secrets set/unset` (la terminal).
import { describe, expect, it } from "vitest";

import { memorySecretStore } from "./secret-store";
import { ENV_LIMIT_BYTES } from "./secrets";
import { setFunctionSecrets, unsetFunctionSecrets, type SecretsDeps } from "./secrets-core";

function montar(o: { apply?: SecretsDeps["apply"] } = {}) {
  const store = memorySecretStore();
  const aplicados: string[] = [];
  const deps: SecretsDeps = {
    store,
    baseEnv: async (_p, env) => ({ SUPABASE_URL: env === "draft" ? "https://draftrefdraftrefdraf.openlen.app" : "https://abcdefghijklmnopqrst.openlen.app" }),
    apply: o.apply ?? (async (_p, env) => void aplicados.push(env)),
  };
  return { store, aplicados, deps };
}

describe("setFunctionSecrets", () => {
  it("guarda por entorno, lo lleva al motor UNA vez por entorno, y la respuesta no lleva valores", async () => {
    const { store, aplicados, deps } = montar();
    const r = await setFunctionSecrets(
      "p1",
      [
        { environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_1" },
        { environment: "live", name: "STRIPE_SECRET_KEY", value: "sk_live_1" },
        { environment: "draft", name: "STRIPE_WEBHOOK_SECRET", value: "whsec_1" },
      ],
      "u1",
      deps,
    );
    expect(r).toEqual({
      ok: true,
      saved: [
        { environment: "draft", name: "STRIPE_SECRET_KEY" },
        { environment: "draft", name: "STRIPE_WEBHOOK_SECRET" },
        { environment: "live", name: "STRIPE_SECRET_KEY" },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/sk_test_1|sk_live_1|whsec_1/);
    expect(await store.values("p1", "draft")).toEqual({ STRIPE_SECRET_KEY: "sk_test_1", STRIPE_WEBHOOK_SECRET: "whsec_1" });
    expect((await store.list("p1"))[0]!.updatedBy).toBe("u1");
    expect(aplicados.sort()).toEqual(["draft", "live"]);
  });

  it("🔴 nombres: SUPABASE_/AWS_/LAMBDA_ y lo que Lambda no acepta, sin guardar NADA", async () => {
    const { store, deps } = montar();
    const r = await setFunctionSecrets("p1", [{ environment: "draft", name: "OK_KEY", value: "1" }, { environment: "draft", name: "AWS_REGION", value: "x" }], null, deps);
    expect(r).toEqual({ ok: false, error: "invalid_name", name: "AWS_REGION", message: "Env name cannot start with AWS_: AWS_REGION" });
    expect(await store.list("p1")).toEqual([]);
    expect(await setFunctionSecrets("p1", [{ environment: "live", name: "mi-clave", value: "1" }], null, deps)).toMatchObject({ ok: false, error: "invalid_name", name: "mi-clave" });
  });

  it("🔴 4 KB: si un entorno no cabe CON lo que ya tiene, no se guarda nada en ninguno y se dice lo que queda", async () => {
    const { store, aplicados, deps } = montar();
    await store.set("p1", "live", { GRANDE: "x".repeat(3000) }, null);
    const r = await setFunctionSecrets(
      "p1",
      [
        { environment: "draft", name: "PEQUE", value: "1" },
        { environment: "live", name: "OTRO", value: "y".repeat(1200) },
      ],
      null,
      deps,
    );
    expect(r).toMatchObject({ ok: false, error: "env_too_large", environment: "live" });
    if (r.ok || r.error !== "env_too_large") return;
    expect(r.availableBytes).toBe(ENV_LIMIT_BYTES - r.baseBytes);
    expect(r.message).toMatch(/^Edge Function secrets don't fit/);
    expect(await store.values("p1", "draft")).toEqual({});
    expect(aplicados).toEqual([]);
  });

  it("un valor de más de 24.576 bytes no entra", async () => {
    const { deps } = montar();
    expect(await setFunctionSecrets("p1", [{ environment: "draft", name: "MY_KEY", value: "x".repeat(24_577) }], null, deps)).toEqual({
      ok: false,
      error: "value_too_long",
      name: "MY_KEY",
      message: "The value of MY_KEY is longer than 24576 bytes.",
    });
  });

  it("si el motor falla, lo guardado se queda (lo leerá el próximo despliegue)", async () => {
    const { store, deps } = montar({ apply: async () => { throw new Error("motor caído"); } });
    expect(await setFunctionSecrets("p1", [{ environment: "draft", name: "MY_KEY", value: "v" }], null, deps)).toMatchObject({ ok: true });
    expect(await store.values("p1", "draft")).toEqual({ MY_KEY: "v" });
  });
});

describe("unsetFunctionSecrets", () => {
  it("quita, lo lleva al motor, y devuelve sólo lo que había", async () => {
    const { store, aplicados, deps } = montar();
    await store.set("p1", "draft", { A: "1", B: "2" }, null);
    expect(await unsetFunctionSecrets("p1", "draft", ["B", "NO"], deps)).toEqual(["B"]);
    expect(aplicados).toEqual(["draft"]);
    expect(await unsetFunctionSecrets("p1", "draft", ["NO"], deps)).toEqual([]);
    expect(aplicados).toEqual(["draft"]);
  });
});
