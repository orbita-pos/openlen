// @vitest-environment node
//
// /api/projects/[id]/function-secrets (spec local 2026-10-11, Parte 4): quién
// entra, que los valores no vuelven nunca, y el código de cada salida. El
// núcleo de verdad (secrets-core) con el almacén en memoria.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SecretsDeps } from "@/lib/functions/secrets-core";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/projects/acceso", () => import("@/lib/projects/acceso-de-prueba"));
const real = vi.hoisted(() => ({ deps: null as null | SecretsDeps }));
vi.mock("@/lib/functions/secrets-real", () => ({ realSecretsDeps: () => real.deps }));

import { auth } from "@/auth";
import { fijarAccesoDePrueba } from "@/lib/projects/acceso-de-prueba";
import { memorySecretStore } from "@/lib/functions/secret-store";

import { DELETE, GET, POST } from "./route";

const ctx = () => ({ params: Promise.resolve({ id: "p1" }) });
const URL_ = "http://x/api/projects/p1/function-secrets";
const pedir = (m: "GET" | "POST" | "DELETE", cuerpo?: unknown) => {
  const req = new Request(URL_, { method: m, ...(cuerpo === undefined ? {} : { body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) }) });
  return m === "GET" ? GET(req, ctx()) : m === "POST" ? POST(req, ctx()) : DELETE(req, ctx());
};
const comoUsuario = (id: string | null) => vi.mocked(auth).mockResolvedValue((id ? { user: { id } } : null) as never);
const comoRol = (rol: "dueno" | "editor" | "lector") => fijarAccesoDePrueba(() => ({ rol, duenoId: "dueno" }));
let aplicados: string[];

beforeEach(() => {
  fijarAccesoDePrueba(null);
  comoUsuario("u1");
  aplicados = [];
  real.deps = {
    store: memorySecretStore(() => new Date("2026-10-12T10:00:00Z")),
    baseEnv: async () => ({ SUPABASE_URL: "https://abcdefghijklmnopqrst.openlen.app" }),
    apply: async (_p, env) => void aplicados.push(env),
  };
});

describe("/api/projects/[id]/function-secrets", () => {
  it("401 sin sesión; 404 si no entra", async () => {
    comoUsuario(null);
    expect((await pedir("GET")).status).toBe(401);
    comoUsuario("u1");
    fijarAccesoDePrueba(() => null);
    expect((await pedir("GET")).status).toBe(404);
    expect((await pedir("POST", { secrets: [{ environment: "draft", name: "MY_KEY", value: "v" }] })).status).toBe(404);
  });

  it("sin motor: GET dice que no hay; POST y DELETE, 503", async () => {
    real.deps = null;
    expect(await (await pedir("GET")).json()).toEqual({ available: false, draft: [], live: [] });
    expect((await pedir("POST", { secrets: [{ environment: "draft", name: "MY_KEY", value: "v" }] })).status).toBe(503);
    expect((await pedir("DELETE", { environment: "draft", names: ["MY_KEY"] })).status).toBe(503);
  });

  it("🔴 guardar: al motor por entorno, y ni la respuesta ni el GET llevan el valor", async () => {
    const r = await pedir("POST", { secrets: [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_xyz123" }, { environment: "live", name: "STRIPE_SECRET_KEY", value: "sk_live_xyz123" }] });
    expect(r.status).toBe(200);
    const cuerpo = await r.text();
    expect(cuerpo).not.toMatch(/sk_(test|live)_xyz123/);
    expect(JSON.parse(cuerpo)).toEqual({ ok: true, saved: [{ environment: "draft", name: "STRIPE_SECRET_KEY" }, { environment: "live", name: "STRIPE_SECRET_KEY" }] });
    expect(aplicados.sort()).toEqual(["draft", "live"]);
    const g = await (await pedir("GET")).text();
    expect(g).not.toMatch(/sk_(test|live)_xyz123/);
    expect(JSON.parse(g)).toMatchObject({ available: true, draft: [{ name: "STRIPE_SECRET_KEY", digest: expect.stringMatching(/^[0-9a-f]{64}$/), updatedAt: "2026-10-12T10:00:00.000Z" }] });
  });

  it("🔴 un proyecto compartido: el editor guarda (borrador y producción); el lector ve sólo nombres y no guarda", async () => {
    comoRol("editor");
    expect((await pedir("POST", { secrets: [{ environment: "live", name: "MY_KEY", value: "v" }] })).status).toBe(200);
    comoRol("lector");
    expect((await pedir("POST", { secrets: [{ environment: "live", name: "MY_KEY", value: "w" }] })).status).toBe(403);
    expect((await pedir("DELETE", { environment: "live", names: ["MY_KEY"] })).status).toBe(403);
    expect(await (await pedir("GET")).json()).toEqual({ available: true, draft: [], live: [{ name: "MY_KEY" }] });
  });

  it("errores: cuerpo malo 400; nombre que no vale 400; no cabe 422 con lo que queda, sin guardar", async () => {
    expect((await pedir("POST", "no es json")).status).toBe(400);
    expect((await pedir("POST", { secrets: [] })).status).toBe(400);
    const n = await pedir("POST", { secrets: [{ environment: "draft", name: "SUPABASE_X", value: "v" }] });
    expect(n.status).toBe(400);
    expect(await n.json()).toEqual({ error: "invalid_name", name: "SUPABASE_X", message: "Env name cannot start with SUPABASE_: SUPABASE_X" });
    // La base de la prueba trae UNA variable: con 120 guardadas, 8 más no caben.
    await real.deps!.store.set("p1", "live", Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`YA_${i}`, "v"])), null);
    const g = await pedir("POST", { secrets: Array.from({ length: 8 }, (_, i) => ({ environment: "live", name: `MY_KEY_${i}`, value: "v" })) });
    expect(g.status).toBe(422);
    expect(await g.json()).toMatchObject({ error: "env_too_large", environment: "live", availableVars: 127 });
    const lista = (await (await pedir("GET")).json()) as { live: { name: string }[] };
    expect(lista.live.some((s) => s.name.startsWith("MY_KEY_"))).toBe(false);
  });

  it("una clave que un gancho rechaza (Stripe, spec local 2026-10-21): 400 rejected con el motivo, sin guardar", async () => {
    real.deps = {
      ...real.deps!,
      hooks: [{ prepare: async () => ({ rejection: { environment: "draft", name: "STRIPE_SECRET_KEY", reason: "live_in_draft", message: "m" } }) }],
    };
    const r = await pedir("POST", { secrets: [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_live_x" }] });
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "rejected", environment: "draft", name: "STRIPE_SECRET_KEY", reason: "live_in_draft", message: "m" });
    expect(await real.deps.store.list("p1")).toEqual([]);
  });

  it("quitar", async () => {
    await pedir("POST", { secrets: [{ environment: "draft", name: "MY_KEY", value: "v" }] });
    aplicados = [];
    expect(await (await pedir("DELETE", { environment: "draft", names: ["MY_KEY", "NO"] })).json()).toEqual({ ok: true, removed: ["MY_KEY"] });
    expect(aplicados).toEqual(["draft"]);
  });
});
