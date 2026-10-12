// lib/functions/runtime/runtime.mjs — EL ENVOLTORIO DE LAS EDGE FUNCTIONS (spec
// local 2026-10-11, Parte 2). Va DENTRO del paquete de cada proyecto (el
// empaquetador lo mete como módulo `openlen:runtime`) y corre en Node: en el
// motor local, en un worker_thread; en Lambda (fase 3), como su manejador.
//
// Lo que hace: lo que el código de Supabase espera de Deno —`Deno.serve`,
// `Deno.env`, `EdgeRuntime.waitUntil`— sobre Node, y cada llamada como MARCOS
// (una línea JSON cada uno) hacia la puerta: cabecera, trozos del cuerpo, fin
// del cuerpo, registros (`console.*`, aparte del cuerpo) y fin. Así la misma
// puerta sirve a los dos motores.
//
// Cada función se carga la PRIMERA vez que se llama (una rota sólo rompe ésa);
// su `Deno.serve` se apunta a nombre de la que se está cargando. Las cargas van
// en serie: dos funciones que se cargan a la vez no se pisan el nombre.

import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";
import { format } from "node:util";

const als = new AsyncLocalStorage();
/** La que se está cargando: `{ handlers, name }` (cada `createHandler` tiene su mapa). */
let loading = null;
let chain = Promise.resolve();
let installed = false;

const HIDDEN = /^(AWS_|LAMBDA_|_HANDLER$|_X_AMZN|AMZN_)/;

function serve(a, b) {
  const handler = typeof a === "function" ? a : typeof b === "function" ? b : a && typeof a.handler === "function" ? a.handler : null;
  if (!handler) throw new TypeError("Deno.serve needs a handler function");
  if (loading === null) throw new Error("Deno.serve was called outside the load of a function");
  loading.handlers.set(loading.name, handler);
  return {
    finished: new Promise(() => {}),
    shutdown: async () => {},
    ref() {},
    unref() {},
    addr: { hostname: "0.0.0.0", port: 9999, transport: "tcp" },
  };
}

const env = {
  get: (k) => (HIDDEN.test(k) ? undefined : process.env[k]),
  has: (k) => !HIDDEN.test(k) && Object.hasOwn(process.env, k),
  set: (k, v) => {
    process.env[k] = String(v);
  },
  delete: (k) => {
    delete process.env[k];
  },
  toObject: () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !HIDDEN.test(k))),
};

export function installGlobals() {
  if (installed) return;
  installed = true;
  // Algunas librerías miran `Deno.version` / `Deno.build` para su cabecera de
  // cliente: se los damos. Una API que no está aquí es `undefined`, y su
  // TypeError se traduce al lanzarse (`mensaje`).
  globalThis.Deno = {
    serve,
    env,
    cwd: () => "/var/task",
    build: { os: "linux", arch: process.arch === "arm64" ? "aarch64" : "x86_64" },
    version: { deno: "2.1.4", v8: process.versions.v8, typescript: "5.6.2" },
  };
  globalThis.EdgeRuntime = {
    waitUntil(p) {
      const ctx = als.getStore();
      if (ctx) ctx.waits.push(Promise.resolve(p).catch((e) => ctx.log("error", [e])));
    },
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const ctx = als.getStore();
      if (ctx) ctx.log(level, args);
      else original(...args);
    };
  }
}

function mensaje(e) {
  const m = e instanceof Error ? e.message : String(e);
  const deno = /^Deno\.(\w+) is not a function$/.exec(m) ?? /^Cannot read properties of undefined \(reading '(\w+)'\)$/.exec(m);
  return deno && /Deno\./.test(m) ? `${m}: Deno.${deno[1]} is not available in OpenLen Edge Functions` : m;
}

const pila = (e) => (e instanceof Error ? e.stack ?? null : null);

class BootError extends Error {}

export function createHandler(loaders) {
  const handlers = new Map();
  async function ensure(name) {
    if (handlers.has(name)) return handlers.get(name);
    if (!Object.hasOwn(loaders, name)) return null;
    const run = chain.then(async () => {
      if (handlers.has(name)) return;
      loading = { handlers, name };
      let mod;
      try {
        mod = await loaders[name]();
      } finally {
        loading = null;
      }
      // La forma nueva de la plantilla de Supabase: `export default { fetch }`.
      const fetchDe = mod && mod.default && typeof mod.default.fetch === "function" ? mod.default : null;
      if (!handlers.has(name) && fetchDe) handlers.set(name, (req, info) => fetchDe.fetch(req, info));
    });
    chain = run.catch(() => undefined);
    await run;
    if (!handlers.has(name)) throw new BootError(`supabase/functions/${name} loaded but never called Deno.serve`);
    return handlers.get(name);
  }

  return async function invoke(event, sink) {
    const started = performance.now();
    const write = (f) => sink.write(`${JSON.stringify(f)}\n`);
    const ctx = { waits: [], log: (level, args) => write({ t: "log", level, msg: format(...args) }) };
    await als.run(ctx, async () => {
      let handler;
      try {
        handler = await ensure(event.fn);
      } catch (e) {
        write({ t: "error", kind: "boot", message: mensaje(e), stack: pila(e) });
        return;
      }
      if (!handler) {
        write({ t: "error", kind: "not_found" });
        return;
      }
      const url = `https://${event.host}/${event.fn}${event.path}${event.query ? `?${event.query}` : ""}`;
      const init = { method: event.method, headers: event.headers };
      if (event.bodyB64 && event.method !== "GET" && event.method !== "HEAD") init.body = Buffer.from(event.bodyB64, "base64");
      const info = { remoteAddr: { hostname: event.remoteAddr, port: 0, transport: "tcp" }, completed: Promise.resolve() };
      let res;
      try {
        res = await handler(new Request(url, init), info);
      } catch (e) {
        write({ t: "error", kind: "uncaught", message: mensaje(e), stack: pila(e) });
        return;
      }
      if (!(res instanceof Response)) {
        write({ t: "error", kind: "uncaught", message: "The handler did not return a Response" });
        return;
      }
      write({ t: "head", status: res.status, headers: [...res.headers] });
      if (res.body) {
        const reader = res.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            write({ t: "body", b: Buffer.from(value).toString("base64") });
          }
        } catch (e) {
          ctx.log("error", [e]);
        }
      }
      write({ t: "body_end" });
      while (ctx.waits.length > 0) await Promise.allSettled(ctx.waits.splice(0));
    });
    write({ t: "end", ms: Math.round(performance.now() - started) });
    sink.end();
  };
}
