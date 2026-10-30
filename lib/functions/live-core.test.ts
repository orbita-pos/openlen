// @vitest-environment node
//
// Producción al publicar (spec local 2026-10-11, Parte 2), con dobles.
import { describe, expect, it } from "vitest";

import type { FunctionsBundle } from "./bundler/bundle-functions";
import type { DeployDeps } from "./deploy-core";
import { memoryDeploymentStore } from "./deployments";
import type { Destination, EngineBundle, FunctionsEngine, FunctionsEnvironment } from "./engines/types";
import { deployLiveRelease, ensureLiveDeployed, prepareLiveRelease, swapBundle } from "./live-core";
import { FunctionSecretsMissingError, FunctionsBundlerUnavailableError, FunctionsDoNotCompileError, FunctionsNeedOwnerError } from "./publish-errors";

const REF = "abcdefghijklmnopqrst";
const ok = (hash: string, nombres: string[]): FunctionsBundle => ({
  ok: true,
  hash,
  files: { "index.mjs": `// ${hash}` },
  maps: {},
  functions: nombres.map((name) => ({ name, entry: `/supabase/functions/${name}/index.ts`, verifyJwt: true, importMap: null })),
  warnings: [],
});
const OWNER = { mode: "owner" as const, skipMissingSecrets: false };

function montar(o: { bundle?: () => FunctionsBundle | null } = {}) {
  const desplegados = new Map<FunctionsEnvironment, { hash: string; files: Record<string, string>; env: Record<string, string> }>();
  const llamadas: string[] = [];
  const modos: string[] = [];
  const engine: FunctionsEngine = {
    name: "local",
    async deploy(dest: Destination, b: EngineBundle, env) {
      llamadas.push(`deploy ${dest.environment} ${b.hash}`);
      desplegados.set(dest.environment, { hash: b.hash, files: { ...b.files }, env: { ...env } });
    },
    async setEnv() {},
    async deployedHash(dest) {
      return desplegados.get(dest.environment)?.hash ?? null;
    },
    invoke: async function* () {},
    async remove(dest) {
      llamadas.push(`remove ${dest.environment}`);
      desplegados.delete(dest.environment);
    },
  };
  const store = memoryDeploymentStore();
  const secretos: Record<FunctionsEnvironment, Record<string, string>> = { draft: {}, live: {} };
  let files: Record<string, string> = { "/supabase/functions/checkout/index.ts": 'const k = Deno.env.get("STRIPE_SECRET_KEY");\n' };
  const deps: DeployDeps = {
    engine,
    store,
    loadFiles: async () => files,
    target: async (_p, env) => ({
      ref: REF,
      url: env === "draft" ? "https://draftrefdraftrefdraf.openlen.app" : `https://${REF}.openlen.app`,
      publishableKey: "sb_publishable_x",
      secretKey: "sb_secret_y",
      plan: "pro",
      secrets: { ...secretos[env] },
    }),
    bundle: async (_f, _c, mode) => (modos.push(mode), (o.bundle ?? (() => ok("p1h", ["checkout"])))()),
  };
  return { deps, store, secretos, llamadas, desplegados, modos, setFiles: (f: Record<string, string>) => (files = f) };
}

describe("prepareLiveRelease", () => {
  it("a Len Watch branch's functions come from its copy (sourcesFrom); where they deploy stays the project's", async () => {
    const m = montar();
    const asked: string[] = [];
    const deps: DeployDeps = { ...m.deps, loadFiles: async (id: string) => (asked.push(id), m.deps.loadFiles(id)) };
    await prepareLiveRelease("p", deps, { ...OWNER, skipMissingSecrets: true, sourcesFrom: "copy-1" });
    expect(asked).toEqual(["copy-1"]);
  });

  it("compila para PRODUCCIÓN; lo que no compila, o el empaquetador mudo, no se publica", async () => {
    const m = montar();
    m.secretos.live.STRIPE_SECRET_KEY = "sk_live_1";
    await prepareLiveRelease("p", m.deps, OWNER);
    expect(m.modos).toEqual(["production"]);
    const roto = montar({ bundle: () => ({ ok: false, errors: [{ ruta: "/supabase/functions/checkout/index.ts", linea: 3, columna: 5, gravedad: "Error", mensaje: "x" }], warnings: [] }) });
    await expect(prepareLiveRelease("p", roto.deps, OWNER)).rejects.toBeInstanceOf(FunctionsDoNotCompileError);
    await expect(prepareLiveRelease("p", montar({ bundle: () => null }).deps, OWNER)).rejects.toBeInstanceOf(FunctionsBundlerUnavailableError);
  });

  it("🔴 un Deno.env.get literal sin valor EN PRODUCCIÓN → 428; «Publicar igual» lo salta", async () => {
    const m = montar();
    m.secretos.draft.STRIPE_SECRET_KEY = "sk_test_1"; // en el borrador sí: no cuenta
    const e = await prepareLiveRelease("p", m.deps, OWNER).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FunctionSecretsMissingError);
    expect((e as FunctionSecretsMissingError).missing).toEqual(["STRIPE_SECRET_KEY"]);
    expect(await prepareLiveRelease("p", m.deps, { mode: "owner", skipMissingSecrets: true })).toMatchObject({ kind: "deploy", missingSecrets: ["STRIPE_SECRET_KEY"] });
    m.secretos.live.STRIPE_SECRET_KEY = "sk_live_1";
    expect(await prepareLiveRelease("p", m.deps, OWNER)).toMatchObject({ kind: "deploy", missingSecrets: [] });
  });

  it("🔴 sin funciones: si producción tenía, se quitan; si no, nada", async () => {
    const m = montar({ bundle: () => ok("empty", []) });
    expect(await prepareLiveRelease("p", m.deps, OWNER)).toEqual({ kind: "none" });
    await m.store.put({ projectId: "p", environment: "live", catalog: "2026-11", hash: "viejo", functions: [{ name: "webhook", verifyJwt: false }], deployedAt: new Date() }, {}, { "index.mjs": "x" });
    expect(await prepareLiveRelease("p", m.deps, OWNER)).toEqual({ kind: "remove" });
    await expect(prepareLiveRelease("p", m.deps, { mode: "system", skipMissingSecrets: false })).rejects.toBeInstanceOf(FunctionsNeedOwnerError);
  });

  it("🔴 modo system: lo que cambiaría producción lo publica el dueño; lo mismo, sí (sin pedir secretos)", async () => {
    const m = montar();
    await expect(prepareLiveRelease("p", m.deps, { mode: "system", skipMissingSecrets: false })).rejects.toBeInstanceOf(FunctionsNeedOwnerError);
    await m.store.put({ projectId: "p", environment: "live", catalog: "2026-11", hash: "p1h", functions: [{ name: "checkout", verifyJwt: true }], deployedAt: new Date() }, {}, { "index.mjs": "// p1h" });
    expect(await prepareLiveRelease("p", m.deps, { mode: "system", skipMissingSecrets: false })).toMatchObject({ kind: "deploy", missingSecrets: [] });
  });
});

describe("Stripe's live ids in the functions (spec local 2026-10-21-stripe-integration, §6.4)", () => {
  const swap = (t: string) => t.replaceAll("price_TEST", "price_LIVE");
  const conPrecio = (): FunctionsBundle => ({ ...ok("x", ["checkout"]), files: { "index.mjs": 'const p = "price_TEST";' } } as FunctionsBundle);

  it("swapBundle changes the files and the hash; the same swap gives the same hash", () => {
    const b = conPrecio() as Extract<FunctionsBundle, { ok: true }>;
    const a = swapBundle(b, swap);
    expect(a.files["index.mjs"]).toBe('const p = "price_LIVE";');
    expect(a.hash).not.toBe(b.hash);
    expect(swapBundle(b, swap).hash).toBe(a.hash);
    expect(b.files["index.mjs"]).toBe('const p = "price_TEST";');
  });

  it("deploy carries the live ids", async () => {
    const m = montar({ bundle: conPrecio });
    m.secretos.live.STRIPE_SECRET_KEY = "sk_live_1";
    const r = await prepareLiveRelease("p", m.deps, OWNER);
    await deployLiveRelease("p", r, m.deps, swap);
    expect(m.desplegados.get("live")!.files["index.mjs"]).toBe('const p = "price_LIVE";');
    expect(await m.store.bundle("p", "live")).toEqual({ "index.mjs": 'const p = "price_LIVE";' });
  });

  it("Review 2: a system republish with the same twins matches the deployed hash", async () => {
    const m = montar({ bundle: conPrecio });
    const desplegado = swapBundle(conPrecio() as Extract<FunctionsBundle, { ok: true }>, swap);
    await m.store.put({ projectId: "p", environment: "live", catalog: "2026-11", hash: desplegado.hash, functions: [{ name: "checkout", verifyJwt: true }], deployedAt: new Date() }, {}, desplegado.files);
    expect(await prepareLiveRelease("p", m.deps, { mode: "system", skipMissingSecrets: false, swap })).toMatchObject({ kind: "deploy" });
    await expect(prepareLiveRelease("p", m.deps, { mode: "system", skipMissingSecrets: false })).rejects.toBeInstanceOf(FunctionsNeedOwnerError);
  });
});

describe("deployLiveRelease", () => {
  it("despliega a producción con SU URL y SUS secretos, y guarda el paquete; lo mismo otra vez → nada", async () => {
    const m = montar();
    m.secretos.live.STRIPE_SECRET_KEY = "sk_live_1";
    const r = await prepareLiveRelease("p", m.deps, OWNER);
    await deployLiveRelease("p", r, m.deps);
    expect(m.desplegados.get("live")).toMatchObject({ hash: "p1h", env: { SUPABASE_URL: `https://${REF}.openlen.app`, STRIPE_SECRET_KEY: "sk_live_1" } });
    expect(await m.store.get("p", "live")).toMatchObject({ hash: "p1h", functions: [{ name: "checkout", verifyJwt: true }] });
    expect(await m.store.bundle("p", "live")).toEqual({ "index.mjs": "// p1h" });
    await deployLiveRelease("p", r, m.deps);
    expect(m.llamadas).toEqual(["deploy live p1h"]);
  });

  it("remove: fuera del motor y del registro", async () => {
    const m = montar();
    await deployLiveRelease("p", await prepareLiveRelease("p", m.deps, { mode: "owner", skipMissingSecrets: true }), m.deps);
    await deployLiveRelease("p", { kind: "remove" }, m.deps);
    expect(m.llamadas.at(-1)).toBe("remove live");
    expect(await m.store.get("p", "live")).toBeNull();
  });
});

describe("ensureLiveDeployed", () => {
  it("🔴 con el motor vacío (un reinicio) repone el paquete GUARDADO de producción, no los ficheros de ahora", async () => {
    const m = montar();
    m.secretos.live.STRIPE_SECRET_KEY = "sk_live_1";
    await deployLiveRelease("p", await prepareLiveRelease("p", m.deps, OWNER), m.deps);
    m.desplegados.clear();
    m.setFiles({ "/supabase/functions/otra/index.ts": "lo del borrador" });
    const compilados = m.modos.length;
    await ensureLiveDeployed("p", REF, m.deps);
    expect(m.desplegados.get("live")).toMatchObject({
      hash: "p1h",
      files: { "index.mjs": "// p1h" },
      env: { STRIPE_SECRET_KEY: "sk_live_1", SUPABASE_URL: `https://${REF}.openlen.app` },
    });
    expect(m.modos.length).toBe(compilados); // no compiló nada
  });

  it("con lo mismo en el motor no toca nada; sin nada publicado, tampoco", async () => {
    const m = montar();
    await ensureLiveDeployed("p", REF, m.deps);
    expect(m.llamadas).toEqual([]);
    await deployLiveRelease("p", await prepareLiveRelease("p", m.deps, { mode: "owner", skipMissingSecrets: true }), m.deps);
    await ensureLiveDeployed("p", REF, m.deps);
    expect(m.llamadas).toEqual(["deploy live p1h"]);
  });
});
