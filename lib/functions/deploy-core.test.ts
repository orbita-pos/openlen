// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import type { FunctionsBundle } from "./bundler/bundle-functions";
import { applyFunctionEnv, deployDraft, deployDraftSerialized, ensureDraftDeployed, pendingDraftDeploy, scheduleDraftDeploy, type DeployDeps } from "./deploy-core";
import { memoryDeploymentStore } from "./deployments";
import type { Destination, EngineBundle, FunctionsEngine, FunctionsEnvironment } from "./engines/types";

afterEach(() => vi.useRealTimers());

const REF = "abcdefghijklmnopqrst";

function motor() {
  const desplegados = new Map<string, string>();
  const entornos = new Map<string, Record<string, string>>();
  const llamadas: string[] = [];
  const engine: FunctionsEngine = {
    name: "local",
    async deploy(dest: Destination, b: EngineBundle, env: Readonly<Record<string, string>>) {
      llamadas.push(`deploy ${dest.environment} ${b.hash} ${env.SUPABASE_URL}`);
      desplegados.set(`${dest.ref}|${dest.environment}`, b.hash);
      entornos.set(`${dest.ref}|${dest.environment}`, { ...env });
    },
    async setEnv(dest, env) {
      llamadas.push(`setEnv ${dest.environment}`);
      if (desplegados.has(`${dest.ref}|${dest.environment}`)) entornos.set(`${dest.ref}|${dest.environment}`, { ...env });
    },
    async deployedHash(dest) {
      return desplegados.get(`${dest.ref}|${dest.environment}`) ?? null;
    },
    invoke: async function* () {},
    async remove(dest) {
      llamadas.push(`remove ${dest.environment}`);
      desplegados.delete(`${dest.ref}|${dest.environment}`);
    },
  };
  return { engine, llamadas, desplegados, entornos };
}

const ok = (hash: string, nombres: string[]): FunctionsBundle => ({
  ok: true,
  hash,
  files: { "index.mjs": `// ${hash}` },
  maps: { "index.mjs": "{}" },
  functions: nombres.map((name) => ({ name, entry: `/supabase/functions/${name}/index.ts`, verifyJwt: name !== "webhook", importMap: null })),
  warnings: [],
});

function deps(o: { bundle: (files: Record<string, string>) => FunctionsBundle | null; files?: Record<string, string> }) {
  const m = motor();
  const store = memoryDeploymentStore();
  let files = o.files ?? { "/supabase/functions/a/index.ts": "v1" };
  const secretos: Record<FunctionsEnvironment, Record<string, string>> = { draft: {}, live: {} };
  const d: DeployDeps = {
    engine: m.engine,
    store,
    loadFiles: async () => files,
    target: async (_p, env) => ({
      ref: REF,
      url: env === "draft" ? "https://draftrefdraftrefdraf.openlen.app" : `https://${REF}.openlen.app`,
      publishableKey: "sb_publishable_x",
      secretKey: "sb_secret_y",
      plan: "free",
      secrets: { ...secretos[env] },
    }),
    bundle: async (f) => o.bundle(f),
  };
  return { d, m, store, secretos, setFiles: (f: Record<string, string>) => (files = f) };
}

describe("deployDraft", () => {
  it("despliega con las variables del borrador y lo anota; igual otra vez → unchanged", async () => {
    const { d, m, store } = deps({ bundle: () => ok("h1", ["a", "webhook"]) });
    expect(await deployDraft("p1", d)).toEqual({ kind: "deployed", functions: ["a", "webhook"], warnings: [] });
    expect(m.llamadas).toEqual(["deploy draft h1 https://draftrefdraftrefdraf.openlen.app"]);
    expect(await store.get("p1", "draft")).toMatchObject({ hash: "h1", functions: [{ name: "a", verifyJwt: true }, { name: "webhook", verifyJwt: false }] });
    expect(await store.maps("p1", "draft")).toEqual({ "index.mjs": "{}" });
    expect(await deployDraft("p1", d)).toMatchObject({ kind: "unchanged" });
    expect(m.llamadas).toHaveLength(1);
  });

  it("si no compila, lo de antes sigue sirviendo", async () => {
    let vez = 0;
    const { d, store } = deps({
      bundle: () => (++vez === 1 ? ok("h1", ["a"]) : { ok: false, errors: [{ ruta: "/supabase/functions/a/index.ts", linea: 2, columna: 1, gravedad: "Error", mensaje: "x" }], warnings: [] }),
    });
    await deployDraft("p1", d);
    expect(await deployDraft("p1", d)).toMatchObject({ kind: "failed", errors: [{ linea: 2 }] });
    expect((await store.get("p1", "draft"))!.hash).toBe("h1");
  });

  it("sin funciones, se quita; el hilo que no contesta es `unavailable`", async () => {
    let vez = 0;
    const { d, m, store } = deps({ bundle: () => (++vez === 1 ? ok("h1", ["a"]) : vez === 2 ? ok("empty", []) : null) });
    await deployDraft("p1", d);
    expect(await deployDraft("p1", d)).toEqual({ kind: "removed" });
    expect(m.llamadas.at(-1)).toBe("remove draft");
    expect(await store.get("p1", "draft")).toBeNull();
    expect(await deployDraft("p1", d)).toEqual({ kind: "unavailable" });
  });

  it("con `files` usa ésos (los de la terminal, aún sin guardar)", async () => {
    const vistos: Record<string, string>[] = [];
    const { d } = deps({ bundle: (f) => (vistos.push(f), ok("h", ["a"])) });
    await deployDraft("p1", d, { files: { "/supabase/functions/a/index.ts": "de la terminal" } });
    expect(vistos[0]).toEqual({ "/supabase/functions/a/index.ts": "de la terminal" });
  });

  it("🔴 si el motor falla al desplegar (Cloudflare contesta un error), es engine_error con su mensaje y no se anota nada", async () => {
    const { d, m, store } = deps({ bundle: () => ok("h1", ["a"]) });
    m.engine.deploy = async () => {
      throw new Error("Uncaught SyntaxError at worker.mjs");
    };
    expect(await deployDraft("p1", d)).toEqual({ kind: "engine_error", message: "Uncaught SyntaxError at worker.mjs" });
    expect(await store.get("p1", "draft")).toBeNull();
  });
});

describe("en serie, programado, y tras un reinicio", () => {
  it("dos seguidos van en orden y el segundo lee los ficheros nuevos", async () => {
    const vistos: string[] = [];
    const { d, setFiles } = deps({ bundle: (f) => (vistos.push(f["/supabase/functions/a/index.ts"]!), ok(f["/supabase/functions/a/index.ts"]!, ["a"])) });
    const uno = deployDraftSerialized("p2", d);
    setFiles({ "/supabase/functions/a/index.ts": "v2" });
    const dos = deployDraftSerialized("p2", d);
    await Promise.all([uno, dos]);
    expect(vistos).toEqual(["v2", "v2"]);
  });

  it("programar dos veces seguidas despliega UNA, a los 2 s", async () => {
    vi.useFakeTimers();
    const veces: number[] = [];
    const { d } = deps({ bundle: () => (veces.push(1), ok("h", ["a"])) });
    scheduleDraftDeploy("p3", d);
    scheduleDraftDeploy("p3", d);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(veces).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await pendingDraftDeploy("p3");
    expect(veces).toHaveLength(1);
  });

  it("🔴 ensureDraftDeployed espera el despliegue en curso", async () => {
    let soltar!: () => void;
    const espera = new Promise<void>((r) => (soltar = r));
    const { d, m } = deps({ bundle: () => ok("nuevo", ["a"]) });
    const lento: DeployDeps = { ...d, bundle: async (f, c, mode) => (await espera, d.bundle(f, c, mode)) };
    void deployDraftSerialized("p4", lento);
    let listo = false;
    const e = ensureDraftDeployed("p4", REF, lento).then(() => (listo = true));
    await new Promise((r) => setTimeout(r, 20));
    expect(listo).toBe(false);
    soltar();
    await e;
    expect(m.desplegados.get(`${REF}|draft`)).toBe("nuevo");
  });

  it("🔴 ensureDraftDeployed no se queda con lo viejo: lo programado se despliega YA, sin esperar los 2 s", async () => {
    vi.useFakeTimers();
    const { d, m, setFiles } = deps({ bundle: (f) => ok(f["/supabase/functions/a/index.ts"]!, ["a"]) });
    await deployDraft("p6", d);
    expect(m.desplegados.get(`${REF}|draft`)).toBe("v1");
    setFiles({ "/supabase/functions/a/index.ts": "v2" });
    scheduleDraftDeploy("p6", d); // se guardó desde la lente Código: el despliegue espera 2 s
    await ensureDraftDeployed("p6", REF, d); // y el lienzo llama ya
    expect(m.desplegados.get(`${REF}|draft`)).toBe("v2");
  });

  it("🔴 redespliega si el motor no tiene el hash anotado (reinicio)", async () => {
    const { d, m } = deps({ bundle: () => ok("h1", ["a"]) });
    await deployDraft("p5", d);
    m.desplegados.clear(); // el motor local se vació al reiniciar
    await ensureDraftDeployed("p5", REF, d);
    expect(m.desplegados.get(`${REF}|draft`)).toBe("h1");
    expect(m.llamadas.filter((l) => l.startsWith("deploy"))).toHaveLength(2);
  });
});

describe("los secretos (fase 2)", () => {
  it("el despliegue del borrador lleva SUS secretos como variables, junto a las SUPABASE_*", async () => {
    const { d, m, secretos } = deps({ bundle: () => ok("h1", ["a"]) });
    secretos.draft.STRIPE_SECRET_KEY = "sk_test_1";
    secretos.live.STRIPE_SECRET_KEY = "sk_live_NO";
    await deployDraft("p-sec", d);
    expect(m.entornos.get(`${REF}|draft`)).toMatchObject({ SUPABASE_URL: "https://draftrefdraftrefdraf.openlen.app", STRIPE_SECRET_KEY: "sk_test_1" });
  });

  it("applyFunctionEnv: al motor con el mismo código; sin nada desplegado, nada", async () => {
    const { d, m, secretos } = deps({ bundle: () => ok("h1", ["a"]) });
    await applyFunctionEnv("p-apl", "draft", d);
    expect(m.llamadas).toEqual([]);
    await deployDraft("p-apl", d);
    secretos.draft.K = "nuevo";
    await applyFunctionEnv("p-apl", "draft", d);
    expect(m.llamadas).toEqual(["deploy draft h1 https://draftrefdraftrefdraf.openlen.app", "setEnv draft"]);
    expect(m.entornos.get(`${REF}|draft`)!.K).toBe("nuevo");
  });

  it("con el motor vacío (un reinicio) no hace nada: lo repondrá ensureDraftDeployed, ya con lo nuevo", async () => {
    const { d, m } = deps({ bundle: () => ok("h1", ["a"]) });
    await deployDraft("p-vacio", d);
    m.desplegados.clear();
    await applyFunctionEnv("p-vacio", "draft", d);
    expect(m.llamadas.filter((l) => l.startsWith("setEnv"))).toEqual([]);
  });

  it("🔴 un secreto guardado DURANTE un despliegue acaba en el motor (no lo pisa lo de antes)", async () => {
    let soltar!: () => void;
    const puerta = new Promise<void>((r) => (soltar = r));
    const { d, m, secretos } = deps({ bundle: () => ok("h1", ["a"]) });
    const deployOriginal = d.engine.deploy;
    const d2: DeployDeps = { ...d, engine: { ...d.engine, deploy: async (...a) => { await puerta; return deployOriginal(...a); } } };
    const despliegue = deployDraftSerialized("p-carrera", d2);
    await new Promise((r) => setTimeout(r, 0)); // ya leyó los secretos de antes
    secretos.draft.STRIPE_SECRET_KEY = "sk_test_nuevo";
    const aplicar = applyFunctionEnv("p-carrera", "draft", d2);
    soltar();
    await Promise.all([despliegue, aplicar]);
    expect(m.entornos.get(`${REF}|draft`)!.STRIPE_SECRET_KEY).toBe("sk_test_nuevo");
  });
});
