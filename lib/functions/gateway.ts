// lib/functions/gateway.ts — LA PUERTA DE LAS EDGE FUNCTIONS (spec local
// 2026-10-11, Parte 3). Una petición a `/functions/v1/<nombre>[/…]`:
//   1. del host al proyecto y al entorno (`resolve`: el ref propio del borrador
//      lo fija; si no, el Origin, como el resto del backend);
//   2. lo desplegado ahí (antes, `ensureDeployed`: lo que esté en curso en el
//      borrador, y lo anotado si el motor se vació);
//   3. `verify_jwt` de esa función;
//   4. ADMITIR antes de llamar: plaza a la vez, cuota del mes, reserva del peor
//      caso en la bolsa. Lo que no entra es un 429 y el motor ni se entera;
//   5. llamar con streaming: la cabecera en cuanto llega, el cuerpo a trozos;
//   6. al acabar (o si el visitante corta), liquidar con nuestro reloj y anotar
//      la llamada con sus registros, tapados, y su traza traducida.
// Sin base ni motor de verdad: todo entra por `GatewayDeps` (serve.ts cablea).

import type { Plan } from "@/lib/plan";

import { admit } from "./admission";
import { checkFunctionAuth } from "./auth";
import type { ConcurrencyLimiter } from "./concurrency";
import type { DeploymentRecord } from "./deployments";
import type { Frame, FunctionsEngine, FunctionsEnvironment, InvokeEvent } from "./engines/types";
import { functionsError, statusOf, type FunctionsErrorCode } from "./errors";
import { MAX_REQUEST_BYTES } from "./limits";
import { maskSecrets } from "./mask";
import type { PoolCaps } from "./meter";
import { translateStack } from "./traces";
import type { UsageStore } from "./usage";

export interface ResolvedTarget {
  readonly projectId: string;
  /** El ref PRINCIPAL (el destino del motor), aunque se entrara por el del borrador. */
  readonly ref: string;
  /** El host por el que entró: el de la URL que ve la función. */
  readonly host: string;
  readonly environment: FunctionsEnvironment;
  readonly publishableKey: string;
  readonly secretKeyHash: string;
  /** Nombre → valor de lo que hay que tapar en lo que Len puede leer. */
  readonly secrets: Readonly<Record<string, string>>;
  jwtSecret(): Promise<string>;
}

export interface InvocationRecord {
  readonly projectId: string;
  readonly environment: FunctionsEnvironment;
  readonly name: string;
  readonly status: number;
  readonly errorCode: string | null;
  readonly ms: number;
  readonly logs: readonly { readonly level: string; readonly msg: string }[];
  readonly error: string | null;
  readonly startedAt: Date;
}

export interface GatewayDeps {
  readonly engine: FunctionsEngine | null;
  resolve(req: Request, o: { readonly forceDraft: boolean }): Promise<ResolvedTarget | { readonly forbidden: string } | null>;
  plan(projectId: string): Promise<Plan>;
  ensureDeployed(target: ResolvedTarget): Promise<void>;
  deployment(projectId: string, env: FunctionsEnvironment): Promise<DeploymentRecord | null>;
  maps(projectId: string, env: FunctionsEnvironment): Promise<Record<string, string>>;
  readonly usage: UsageStore;
  readonly limiter: ConcurrencyLimiter;
  readonly caps: PoolCaps;
  record(r: InvocationRecord): Promise<void>;
  now(): Date;
}

const ERROR_DE: Record<Extract<Frame, { t: "error" }>["kind"], FunctionsErrorCode> = {
  not_found: "NOT_FOUND",
  boot: "BOOT_ERROR",
  uncaught: "WORKER_ERROR",
  timeout: "IDLE_TIMEOUT",
  memory: "WORKER_RESOURCE_LIMIT",
};

const MAX_LINEAS = 100;
const MAX_CARACTERES = 2_000;

/** Lo del camino (Caddy, Cloudflare) y lo que pone la puerta, fuera. */
const FUERA_PETICION = new Set([
  "host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade",
  "cf-connecting-ip", "cf-ray", "cf-visitor", "cdn-loop", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-for", "x-real-ip",
]);
const FUERA_RESPUESTA = new Set(["content-length", "transfer-encoding", "connection", "keep-alive"]);

function clientIp(h: Headers): string {
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "127.0.0.1";
}

function forwardedHeaders(h: Headers): [string, string][] {
  const out: [string, string][] = [];
  h.forEach((v, k) => {
    if (!FUERA_PETICION.has(k)) out.push([k, v]);
  });
  out.push(["x-forwarded-for", clientIp(h)]);
  return out;
}

export async function handleFunctionsRequest(req: Request, deps: GatewayDeps, o: { readonly forceDraft?: boolean } = {}): Promise<Response> {
  const engine = deps.engine;
  if (!engine) return functionsError("FUNCTIONS_UNAVAILABLE");
  const url = new URL(req.url);
  const m = /^\/functions\/v1\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (!m) return functionsError("NOT_FOUND");
  const name = decodeURIComponent(m[1]!);
  const subpath = m[2] ?? "";

  const target = await deps.resolve(req, { forceDraft: o.forceDraft === true });
  if (!target) return functionsError("NOT_FOUND");
  if ("forbidden" in target) return functionsError("FORBIDDEN", { message: target.forbidden });

  await deps.ensureDeployed(target);
  const deployment = await deps.deployment(target.projectId, target.environment);
  const fn = deployment?.functions.find((f) => f.name === name);
  if (!deployment || !fn) return functionsError("NOT_FOUND");

  const auth = await checkFunctionAuth(req, {
    verifyJwt: fn.verifyJwt,
    publishableKey: target.publishableKey,
    secretKeyHash: target.secretKeyHash,
    jwtSecret: () => target.jwtSecret(),
  });
  if (!auth.ok) return functionsError(auth.code);

  let body: Buffer | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = Buffer.from(await req.arrayBuffer());
    if (body.length > MAX_REQUEST_BYTES) return functionsError("REQUEST_TOO_LARGE");
  }

  const admission = await admit({ projectId: target.projectId, plan: await deps.plan(target.projectId), now: deps.now(), usage: deps.usage, limiter: deps.limiter, caps: deps.caps });
  if (!admission.ok) return functionsError(admission.reason === "concurrency" ? "RATE_LIMIT_EXCEEDED" : "QUOTA_EXCEEDED");

  const event: InvokeEvent = {
    fn: name,
    method: req.method,
    path: subpath,
    query: url.search.slice(1),
    headers: forwardedHeaders(req.headers),
    bodyB64: body && body.length > 0 ? body.toString("base64") : null,
    host: target.host,
    remoteAddr: clientIp(req.headers),
  };
  const startedAt = deps.now();
  const t0 = performance.now();
  const frames = engine.invoke({ ref: target.ref, environment: target.environment }, event, { timeoutMs: admission.limits.timeoutSec * 1000 })[Symbol.asyncIterator]();

  const logs: { level: string; msg: string }[] = [];
  const tapar = (s: string) => maskSecrets(s, target.secrets);
  let status = 0;
  let errorCode: FunctionsErrorCode | null = null;
  let errorText: string | null = null;
  let anotada = false;

  // El motor puede LANZAR (al arrancar, o a mitad: Lambda sin red, un hilo que
  // muere). Eso es un fin con error, nunca una excepción que deje la plaza y la
  // reserva colgadas.
  const siguiente = async (): Promise<IteratorResult<Frame>> => {
    try {
      return await frames.next();
    } catch (e) {
      errorCode ??= "WORKER_ERROR";
      errorText ??= e instanceof Error ? (e.stack ?? e.message) : String(e);
      return { done: true, value: undefined };
    }
  };
  const tomar = (f: Frame): void => {
    if (f.t === "log") logs.push({ level: f.level, msg: f.msg });
    else if (f.t === "error") {
      errorCode ??= ERROR_DE[f.kind];
      errorText ??= f.stack ?? f.message ?? f.kind;
    }
  };
  const vaciar = async (): Promise<void> => {
    for (;;) {
      const r = await siguiente();
      if (r.done) return;
      tomar(r.value);
    }
  };
  const anotar = async (): Promise<void> => {
    if (anotada) return;
    anotada = true;
    const ms = Math.round(performance.now() - t0);
    await admission.release(ms).catch(() => undefined);
    const error = errorText === null ? null : tapar(translateStack(errorText, await deps.maps(target.projectId, target.environment).catch(() => ({}))));
    await deps
      .record({
        projectId: target.projectId,
        environment: target.environment,
        name,
        status,
        errorCode,
        ms,
        logs: logs.slice(0, MAX_LINEAS).map((l) => ({ level: l.level, msg: tapar(l.msg).slice(0, MAX_CARACTERES) })),
        error,
        startedAt,
      })
      .catch(() => undefined);
  };
  const vaciarYAnotar = () => void vaciar().catch(() => undefined).finally(() => void anotar());

  const responder = (head: Extract<Frame, { t: "head" }>): Response => {
    status = head.status;
    const headers = new Headers();
    for (const [k, v] of head.headers) if (!FUERA_RESPUESTA.has(k.toLowerCase())) headers.append(k, v);
    if (req.method === "HEAD" || head.status === 204 || head.status === 304) {
      vaciarYAnotar();
      return new Response(null, { status: head.status, headers });
    }
    let cerrado = false;
    const cerrar = (c: ReadableStreamDefaultController<Uint8Array>) => {
      if (cerrado) return;
      cerrado = true;
      try {
        c.close();
      } catch {
        /* ya cancelado por el visitante */
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(c) {
        for (;;) {
          const r = await siguiente();
          if (r.done) {
            cerrar(c);
            void anotar();
            return;
          }
          const g = r.value;
          if (g.t === "body") {
            try {
              c.enqueue(new Uint8Array(Buffer.from(g.b, "base64")));
            } catch {
              /* el visitante cortó: se sigue leyendo para anotar */
            }
            return;
          }
          tomar(g);
          if (g.t === "body_end" || g.t === "error") {
            cerrar(c);
            vaciarYAnotar();
            return;
          }
          if (g.t === "end") {
            cerrar(c);
            void anotar();
            return;
          }
        }
      },
      cancel() {
        cerrado = true;
        vaciarYAnotar();
      },
    });
    return new Response(stream, { status: head.status, headers });
  };

  for (;;) {
    const r = await siguiente();
    if (r.done) {
      status = 500;
      errorCode ??= "WORKER_ERROR";
      errorText ??= "the function ended without a response";
      await anotar();
      return functionsError("WORKER_ERROR");
    }
    const f = r.value;
    if (f.t === "head") return responder(f);
    tomar(f);
    if (f.t === "error") {
      await vaciar();
      const code = ERROR_DE[f.kind];
      status = statusOf(code);
      await anotar();
      return functionsError(code);
    }
  }
}
