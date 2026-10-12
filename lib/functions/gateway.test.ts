// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { hashSecretKey } from "@/lib/backend/keys";

import { ConcurrencyLimiter } from "./concurrency";
import type { DeploymentRecord } from "./deployments";
import type { Frame, FunctionsEngine, InvokeEvent } from "./engines/types";
import { handleFunctionsRequest, type GatewayDeps, type InvocationRecord, type ResolvedTarget } from "./gateway";
import { FUNCTION_LIMITS } from "./limits";
import { memoryUsageStore } from "./usage";

const SECRETO_KEY = "sb_secret_abcdefghijklmnopqrstuv";
const TARGET: ResolvedTarget = {
  projectId: "p1",
  ref: "abcdefghijklmnopqrst",
  host: "abcdefghijklmnopqrst.openlen.app",
  environment: "draft",
  published: true,
  publishableKey: "sb_publishable_abc",
  secretKeyHash: hashSecretKey(SECRETO_KEY),
  secrets: { SUPABASE_SERVICE_ROLE_KEY: SECRETO_KEY },
  jwtSecret: async () => "s".repeat(48),
};
const DEPLOY: DeploymentRecord = {
  projectId: "p1",
  environment: "draft",
  catalog: "2026-11",
  hash: "h",
  functions: [
    { name: "hola", verifyJwt: true },
    { name: "webhook", verifyJwt: false },
  ],
  deployedAt: new Date(),
};

type Guion = (e: InvokeEvent) => Frame[] | AsyncIterable<Frame>;
const b64 = (s: string | Uint8Array) => Buffer.from(s).toString("base64");
const responde = (cuerpo: string, status = 200, headers: [string, string][] = []): Frame[] => [
  { t: "head", status, headers },
  { t: "body", b: b64(cuerpo) },
  { t: "body_end" },
  { t: "end", ms: 3 },
];

function montar(guion: Guion = () => responde("ok"), cambia: Partial<GatewayDeps> = {}) {
  const eventos: InvokeEvent[] = [];
  const records: InvocationRecord[] = [];
  const engine: FunctionsEngine = {
    name: "local",
    deploy: async () => undefined,
    setEnv: async () => undefined,
    deployedHash: async () => "h",
    remove: async () => undefined,
    invoke: (_d, e) => {
      eventos.push(e);
      const s = guion(e);
      return Array.isArray(s) ? (async function* () { yield* s; })() : s;
    },
  };
  const deps: GatewayDeps = {
    engine,
    resolve: async () => TARGET,
    plan: async () => "free",
    ensureDeployed: async () => undefined,
    deployment: async (_p, env) => (env === "draft" ? DEPLOY : null),
    maps: async () => ({}),
    usage: memoryUsageStore(),
    limiter: new ConcurrencyLimiter(),
    caps: { free: 1e15, paid: 1e15 },
    record: async (r) => void records.push(r),
    now: () => new Date("2026-10-11T12:00:00Z"),
    ...cambia,
  };
  return { deps, eventos, records };
}

const llamar = (deps: GatewayDeps, ruta = "/functions/v1/webhook", init: RequestInit = {}) =>
  handleFunctionsRequest(new Request(`https://abcdefghijklmnopqrst.openlen.app${ruta}`, { method: "POST", ...init }), deps);

/** Llama y LEE el cuerpo: hasta leerlo, la llamada no acaba y su plaza «a la vez» sigue ocupada. */
const leida = async (p: Promise<Response>) => {
  const r = await p;
  await r.arrayBuffer().catch(() => undefined);
  return r;
};

describe("la puerta", () => {
  it("pendiente de la fase 1: la llamada cuenta «en vuelo» hasta DESPUÉS de anotarse; la que no se admite, no", async () => {
    const vuelo: string[] = [];
    const montado = montar(undefined, {
      inflight: { start: (p, e) => (vuelo.push(`start ${p} ${e}`), () => vuelo.push(`done ${montado.records.length}`)) },
    });
    const r = await llamar(montado.deps);
    await r.arrayBuffer();
    await vi.waitFor(() => expect(vuelo).toEqual(["start p1 draft", "done 1"]));
    const tope = montar(undefined, { caps: { free: 1, paid: 1 }, inflight: { start: () => (vuelo.push("no"), () => {}) } });
    const n = await llamar(tope.deps);
    await n.arrayBuffer();
    expect(n.status).toBe(429);
    expect(vuelo).not.toContain("no");
  });

  it("🔴 despublicada: producción contesta NOT_FOUND, y ni se repone ni se llama; el borrador sigue", async () => {
    const repuestos: string[] = [];
    const { deps, eventos } = montar(undefined, {
      resolve: async () => ({ ...TARGET, environment: "live" as const, published: false }),
      deployment: async () => ({ ...DEPLOY, environment: "live" as const }),
      ensureDeployed: async (t) => void repuestos.push(t.environment),
    });
    const r = await llamar(deps);
    await r.arrayBuffer();
    expect(r.status).toBe(404);
    expect(r.headers.get("sb-error-code")).toBe("NOT_FOUND");
    expect(eventos).toHaveLength(0);
    expect(repuestos).toEqual([]);
    const borrador = montar(undefined, { resolve: async () => ({ ...TARGET, published: false }) });
    const b = await llamar(borrador.deps);
    await b.arrayBuffer();
    expect(b.status).toBe(200);
  });

  it("pendiente de la fase 1: un % mal formado en el nombre es NOT_FOUND, no un 500", async () => {
    const { deps } = montar();
    const r = await llamar(deps, "/functions/v1/%E0%A4%A");
    expect(r.status).toBe(404);
    expect(r.headers.get("sb-error-code")).toBe("NOT_FOUND");
  });

  it("sin motor → 503 FUNCTIONS_UNAVAILABLE", async () => {
    const { deps } = montar(undefined, { engine: null });
    const r = await llamar(deps);
    expect(r.status).toBe(503);
    expect(r.headers.get("sb-error-code")).toBe("FUNCTIONS_UNAVAILABLE");
  });

  it("404: otra ruta, proyecto desconocido, función que no existe; 403 lienzo ajeno", async () => {
    const { deps } = montar();
    expect((await llamar(deps, "/functions/v1/")).status).toBe(404);
    expect((await llamar(deps, "/functions/v1/nada")).headers.get("sb-error-code")).toBe("NOT_FOUND");
    expect(await (await llamar(montar(undefined, { resolve: async () => null }).deps)).json()).toEqual({ code: "NOT_FOUND", message: "Requested function was not found" });
    expect((await llamar(montar(undefined, { resolve: async () => ({ forbidden: "This canvas does not belong to this project." }) }).deps)).status).toBe(403);
  });

  it("🔴 sin Origin y con producción → producción, que aquí no tiene funciones: NOT_FOUND limpio", async () => {
    const { deps, eventos } = montar(undefined, { resolve: async () => ({ ...TARGET, environment: "live" }) });
    expect((await llamar(deps)).status).toBe(404);
    expect(eventos).toHaveLength(0);
  });

  it("verify_jwt: la función con JWT exige cabecera; la de webhook no", async () => {
    const { deps, eventos } = montar();
    const sin = await llamar(deps, "/functions/v1/hola");
    expect(sin.status).toBe(401);
    expect(sin.headers.get("sb-error-code")).toBe("UNAUTHORIZED_NO_AUTH_HEADER");
    expect((await leida(llamar(deps, "/functions/v1/hola", { headers: { authorization: "Bearer sb_publishable_abc" } }))).status).toBe(200);
    expect((await leida(llamar(deps, "/functions/v1/webhook"))).status).toBe(200);
    expect((await leida(llamar(deps, "/functions/v1/hola", { method: "OPTIONS" }))).status).toBe(200);
    expect(eventos.map((e) => e.method)).toEqual(["POST", "POST", "OPTIONS"]);
  });

  it("lo que ve la función: /<nombre><ruta>, query, host, cabeceras sin las de dentro", async () => {
    const { deps, eventos } = montar();
    await llamar(deps, "/functions/v1/webhook/a/b?x=1", { headers: { "cf-connecting-ip": "203.0.113.7", "x-mia": "1", "content-type": "text/plain" }, body: "hola" });
    const e = eventos[0]!;
    expect(e).toMatchObject({ fn: "webhook", path: "/a/b", query: "x=1", host: TARGET.host, remoteAddr: "203.0.113.7", bodyB64: b64("hola") });
    expect(e.headers).toContainEqual(["x-mia", "1"]);
    expect(e.headers).toContainEqual(["x-forwarded-for", "203.0.113.7"]);
    expect(e.headers.some(([k]) => k === "cf-connecting-ip" || k === "host")).toBe(false);
  });

  it("🔴 binario intacto ida y vuelta (3 MB); 🔴 413 por encima de 4 MB sin invocar", async () => {
    const foto = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) % 256);
    const eco: Guion = (e) => [{ t: "head", status: 200, headers: [["content-type", "image/jpeg"]] }, { t: "body", b: e.bodyB64! }, { t: "body_end" }, { t: "end", ms: 1 }];
    const { deps, eventos } = montar(eco);
    const r = await llamar(deps, "/functions/v1/webhook", { body: foto });
    expect(Buffer.from(await r.arrayBuffer()).equals(Buffer.from(foto))).toBe(true);
    const grande = await llamar(deps, "/functions/v1/webhook", { body: new Uint8Array(4 * 1024 * 1024 + 1) });
    expect(grande.status).toBe(413);
    expect(grande.headers.get("sb-error-code")).toBe("REQUEST_TOO_LARGE");
    expect(eventos).toHaveLength(1);
  });

  it("cuota agotada → 429 QUOTA_EXCEEDED; demasiadas a la vez → 429 RATE_LIMIT_EXCEEDED; sin invocar", async () => {
    const usage = memoryUsageStore();
    usage.calls.set("p1|2026-10", FUNCTION_LIMITS.free.callsPerMonth);
    const { deps, eventos } = montar(undefined, { usage });
    const r = await llamar(deps);
    expect(r.status).toBe(429);
    expect(r.headers.get("sb-error-code")).toBe("QUOTA_EXCEEDED");
    const limiter = new ConcurrencyLimiter();
    limiter.tryAcquire("p1", 2);
    limiter.tryAcquire("p1", 2);
    expect((await llamar(montar(undefined, { limiter }).deps)).headers.get("sb-error-code")).toBe("RATE_LIMIT_EXCEEDED");
    expect(eventos).toHaveLength(0);
  });

  it("🔴 el tope de dinero: con la bolsa a casi cero, 429 sin invocar", async () => {
    const { deps, eventos } = montar(undefined, { caps: { free: 100_000, paid: 1e15 } });
    expect((await llamar(deps)).headers.get("sb-error-code")).toBe("QUOTA_EXCEEDED");
    expect(eventos).toHaveLength(0);
  });

  it("errores del envoltorio → sus códigos; queda anotado con su error, tapado", async () => {
    const casos: [Frame, number, string][] = [
      [{ t: "error", kind: "uncaught", message: "x", stack: `Error: clave ${SECRETO_KEY}` }, 500, "WORKER_ERROR"],
      [{ t: "error", kind: "boot", message: "no arranca" }, 503, "BOOT_ERROR"],
      [{ t: "error", kind: "timeout" }, 504, "IDLE_TIMEOUT"],
      [{ t: "error", kind: "memory" }, 546, "WORKER_RESOURCE_LIMIT"],
    ];
    for (const [f, status, code] of casos) {
      const { deps, records } = montar(() => [f, { t: "end", ms: 1 }]);
      const r = await llamar(deps);
      expect(r.status).toBe(status);
      expect(r.headers.get("sb-error-code")).toBe(code);
      await vi.waitFor(() => expect(records).toHaveLength(1));
      expect(records[0]).toMatchObject({ status, errorCode: code });
    }
    const { deps, records } = montar(() => [casos[0]![0], { t: "end", ms: 1 }]);
    await llamar(deps);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(records[0]!.error).toBe("Error: clave [SUPABASE_SERVICE_ROLE_KEY]");
  });

  it("registros anotados y tapados; la plaza se suelta y se liquida al acabar el cuerpo", async () => {
    const usage = memoryUsageStore();
    const limiter = new ConcurrencyLimiter();
    const { deps, records } = montar(
      () => [{ t: "log", level: "log", msg: `usando ${SECRETO_KEY}` }, ...responde("hola", 201, [["x-a", "1"]])],
      { usage, limiter },
    );
    const r = await llamar(deps);
    expect(r.status).toBe(201);
    expect(r.headers.get("x-a")).toBe("1");
    expect(await r.text()).toBe("hola");
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(records[0]).toMatchObject({ name: "webhook", environment: "draft", status: 201, errorCode: null, logs: [{ level: "log", msg: "usando [SUPABASE_SERVICE_ROLE_KEY]" }] });
    expect(limiter.inFlight("p1")).toBe(0);
    expect(usage.pools.get("2026-10|free")!.spent).toBeGreaterThan(0);
    expect(usage.pools.get("2026-10|free")!.reserved).toBe(0);
  });

  it("🔴 cancelar el cuerpo libera y liquida", async () => {
    let seguir!: () => void;
    const espera = new Promise<void>((r) => (seguir = r));
    const limiter = new ConcurrencyLimiter();
    const { deps, records } = montar(
      () =>
        (async function* (): AsyncGenerator<Frame> {
          yield { t: "head", status: 200, headers: [["content-type", "text/event-stream"]] };
          yield { t: "body", b: b64("data: 1\n\n") };
          await espera;
          yield { t: "body", b: b64("data: 2\n\n") };
          yield { t: "log", level: "info", msg: "terminé" };
          yield { t: "body_end" };
          yield { t: "end", ms: 9 };
        })(),
      { limiter },
    );
    const r = await llamar(deps);
    const lector = r.body!.getReader();
    expect(Buffer.from((await lector.read()).value!).toString()).toBe("data: 1\n\n");
    await lector.cancel();
    expect(limiter.inFlight("p1")).toBe(1);
    seguir();
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(records[0]!.logs).toContainEqual({ level: "info", msg: "terminé" });
    expect(limiter.inFlight("p1")).toBe(0);
  });

  it("🔴 un motor que lanza al empezar: 500, la plaza se suelta y queda anotado", async () => {
    const limiter = new ConcurrencyLimiter();
    const { deps, records } = montar(
      () =>
        (async function* (): AsyncGenerator<Frame> {
          throw new Error("el motor no arrancó");
        })(),
      { limiter },
    );
    const r = await llamar(deps);
    expect(r.status).toBe(500);
    expect(r.headers.get("sb-error-code")).toBe("WORKER_ERROR");
    expect(limiter.inFlight("p1")).toBe(0);
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(records[0]!.error).toMatch(/el motor no arrancó/);
  });

  it("🔴 un motor que lanza a mitad del cuerpo: el cuerpo acaba y la plaza se suelta", async () => {
    const limiter = new ConcurrencyLimiter();
    const { deps, records } = montar(
      () =>
        (async function* (): AsyncGenerator<Frame> {
          yield { t: "head", status: 200, headers: [] };
          yield { t: "body", b: b64("a") };
          throw new Error("se cayó");
        })(),
      { limiter },
    );
    const r = await llamar(deps);
    expect(await r.text()).toBe("a");
    await vi.waitFor(() => expect(records).toHaveLength(1));
    expect(records[0]).toMatchObject({ errorCode: "WORKER_ERROR" });
    expect(limiter.inFlight("p1")).toBe(0);
  });

  it("204 sin cuerpo también se anota", async () => {
    const { deps, records } = montar(() => [{ t: "head", status: 204, headers: [] }, { t: "body_end" }, { t: "end", ms: 1 }]);
    const r = await llamar(deps);
    expect(r.status).toBe(204);
    expect(r.body).toBeNull();
    await vi.waitFor(() => expect(records).toHaveLength(1));
  });

  it("espera al despliegue del borrador antes de mirar qué hay", async () => {
    const orden: string[] = [];
    const { deps } = montar(undefined, {
      ensureDeployed: async () => void orden.push("ensure"),
      deployment: async () => (orden.push("deployment"), DEPLOY),
    });
    await llamar(deps);
    expect(orden).toEqual(["ensure", "deployment"]);
  });
});
