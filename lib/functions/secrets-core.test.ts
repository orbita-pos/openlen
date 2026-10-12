// @vitest-environment node
//
// Guardar y quitar secretos (spec local 2026-10-11, Parte 4): lo mismo para la
// tarjeta (la ruta) y para `supabase secrets set/unset` (la terminal).
import { describe, expect, it } from "vitest";

import { memorySecretStore } from "./secret-store";
import { ENV_VARS_MAX, MAX_SECRET_VALUE_BYTES } from "./secrets";
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

  it("🔴 nombres: SUPABASE_ y lo que no es un nombre de variable, sin guardar NADA; AWS_ ya vale", async () => {
    const { store, deps } = montar();
    const r = await setFunctionSecrets("p1", [{ environment: "draft", name: "OK_KEY", value: "1" }, { environment: "draft", name: "SUPABASE_X", value: "x" }], null, deps);
    expect(r).toEqual({ ok: false, error: "invalid_name", name: "SUPABASE_X", message: "Env name cannot start with SUPABASE_: SUPABASE_X" });
    expect(await store.list("p1")).toEqual([]);
    expect(await setFunctionSecrets("p1", [{ environment: "live", name: "mi-clave", value: "1" }], null, deps)).toMatchObject({ ok: false, error: "invalid_name", name: "mi-clave" });
    expect(await setFunctionSecrets("p1", [{ environment: "draft", name: "AWS_ACCESS_KEY_ID", value: "AKIA" }], null, deps)).toMatchObject({ ok: true });
  });

  it("🔴 128 variables: si un entorno no cabe CON lo que ya tiene, no se guarda nada en ninguno y se dice cuántas quedan", async () => {
    // La base de montar() trae UNA variable (SUPABASE_URL).
    const { store, aplicados, deps } = montar();
    await store.set("p1", "live", Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`YA_${i}`, "v"])), null);
    const r = await setFunctionSecrets(
      "p1",
      [{ environment: "draft", name: "PEQUE", value: "1" }, ...Array.from({ length: 8 }, (_, i) => ({ environment: "live" as const, name: `NUEVO_${i}`, value: "v" }))],
      null,
      deps,
    );
    expect(r).toMatchObject({ ok: false, error: "env_too_large", environment: "live", usedVars: 129, baseVars: 1, availableVars: ENV_VARS_MAX - 1 });
    if (r.ok || r.error !== "env_too_large") return;
    expect(r.message).toMatch(/^Edge Function secrets don't fit/);
    expect(await store.values("p1", "draft")).toEqual({});
    expect(aplicados).toEqual([]);
  });

  it("🔴 dos guardados A LA VEZ que caben cada uno solo pero no juntos: entra uno, el otro no cabe", async () => {
    const { store, deps } = montar();
    const lote = (p: string) => Array.from({ length: 64 }, (_, i) => ({ environment: "live" as const, name: `${p}_${i}`, value: "v" }));
    const [a, b] = await Promise.all([setFunctionSecrets("p1", lote("UNO"), null, deps), setFunctionSecrets("p1", lote("DOS"), null, deps)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(Object.keys(await store.values("p1", "live"))).toHaveLength(64);
  });

  it("🔴 un valor de más de 5 KB no entra (el tope de Cloudflare); justo 5 KB, sí", async () => {
    const { deps } = montar();
    expect(await setFunctionSecrets("p1", [{ environment: "draft", name: "MY_KEY", value: "x".repeat(MAX_SECRET_VALUE_BYTES + 1) }], null, deps)).toEqual({
      ok: false,
      error: "value_too_long",
      name: "MY_KEY",
      message: "The value of MY_KEY is longer than 5120 bytes.",
    });
    expect(await setFunctionSecrets("p1", [{ environment: "draft", name: "MY_KEY", value: "x".repeat(MAX_SECRET_VALUE_BYTES) }], null, deps)).toMatchObject({ ok: true });
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
