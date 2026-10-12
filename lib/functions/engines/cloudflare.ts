// lib/functions/engines/cloudflare.ts — EL MOTOR `cloudflare` (spec local
// 2026-10-12, Parte 4). Cada proyecto y entorno es un script de un namespace de
// Workers for Platforms, subido por la API REST con sus variables como
// `secret_text` y el hash del paquete como etiqueta. Se llama a través de
// NUESTRO despachador, que le pone los límites del plan, y los marcos del
// envoltorio vuelven según salen (NDJSON). Sin estado propio: lo desplegado vive
// en Cloudflare (y en `functionDeployments`).

import {
  cfRequest,
  CloudflareApiError,
  COMPATIBILITY_DATE,
  COMPATIBILITY_FLAGS,
  scriptForm,
  WORKER_MAIN_MODULE,
  type CloudflareConfig,
  type Fetch,
} from "./cloudflare-api";
import { destinationName, type CallLimits, type Destination, type EngineBundle, type EngineLimits, type Frame, type FunctionsEngine, type InvokeEvent } from "./types";

const HASH_TAG = "h-";

const noEsta = (e: unknown) => e instanceof CloudflareApiError && e.status === 404;
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class CloudflareEngine implements FunctionsEngine {
  readonly name = "cloudflare" as const;
  readonly #cfg: CloudflareConfig;
  readonly #fetch: Fetch;

  constructor(cfg: CloudflareConfig, f: Fetch = fetch) {
    this.#cfg = cfg;
    this.#fetch = f;
  }

  #script(dest: Destination): string {
    return `/workers/dispatch/namespaces/${encodeURIComponent(this.#cfg.namespace)}/scripts/${destinationName(dest)}`;
  }

  async deploy(dest: Destination, bundle: EngineBundle, env: Readonly<Record<string, string>>, _limits: EngineLimits): Promise<void> {
    const metadata = {
      main_module: WORKER_MAIN_MODULE,
      compatibility_date: COMPATIBILITY_DATE,
      compatibility_flags: [...COMPATIBILITY_FLAGS],
      bindings: Object.entries(env).map(([name, text]) => ({ type: "secret_text", name, text })),
      tags: [`${HASH_TAG}${bundle.hash}`],
    };
    await cfRequest(this.#cfg, this.#fetch, "PUT", this.#script(dest), scriptForm(metadata, bundle.files));
  }

  async setEnv(dest: Destination, env: Readonly<Record<string, string>>): Promise<void> {
    let actuales: { name: string }[];
    try {
      actuales = await cfRequest<{ name: string }[]>(this.#cfg, this.#fetch, "GET", `${this.#script(dest)}/secrets`);
    } catch (e) {
      if (noEsta(e)) return; // sin script, nada: lo que se despliegue después ya los lleva
      throw e;
    }
    for (const [name, text] of Object.entries(env)) {
      await cfRequest(this.#cfg, this.#fetch, "PUT", `${this.#script(dest)}/secrets`, JSON.stringify({ name, text, type: "secret_text" }), "application/json");
    }
    for (const { name } of actuales) {
      if (!Object.hasOwn(env, name)) await cfRequest(this.#cfg, this.#fetch, "DELETE", `${this.#script(dest)}/secrets/${encodeURIComponent(name)}`);
    }
  }

  async deployedHash(dest: Destination): Promise<string | null> {
    try {
      const tags = await cfRequest<string[]>(this.#cfg, this.#fetch, "GET", `${this.#script(dest)}/tags`);
      const t = tags.find((x) => x.startsWith(HASH_TAG));
      return t ? t.slice(HASH_TAG.length) : null;
    } catch (e) {
      if (noEsta(e)) return null;
      throw e;
    }
  }

  async remove(dest: Destination): Promise<void> {
    try {
      await cfRequest(this.#cfg, this.#fetch, "DELETE", this.#script(dest));
    } catch (e) {
      if (!noEsta(e)) throw e;
    }
  }

  async *invoke(dest: Destination, event: InvokeEvent, o: { readonly timeoutMs: number; readonly limits: CallLimits }): AsyncIterable<Frame> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), o.timeoutMs);
    try {
      let res: Response;
      try {
        res = await this.#fetch(this.#cfg.dispatchUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-openlen-dispatch-key": this.#cfg.dispatchKey,
            "x-openlen-script": destinationName(dest),
            "x-openlen-cpu-ms": String(o.limits.cpuMs),
            "x-openlen-subrequests": String(o.limits.subRequests),
          },
          body: JSON.stringify(event),
          signal: ac.signal,
        });
      } catch (e) {
        yield ac.signal.aborted ? { t: "error", kind: "timeout" } : { t: "error", kind: "unavailable", message: mensaje(e) };
        return;
      }
      if (!res.ok || !res.body) {
        await res.body?.cancel().catch(() => undefined);
        yield { t: "error", kind: "unavailable", message: `the dispatcher answered ${res.status}` };
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let resto = "";
      let acabado = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          resto += value;
          for (let i = resto.indexOf("\n"); i !== -1; i = resto.indexOf("\n")) {
            const linea = resto.slice(0, i);
            resto = resto.slice(i + 1);
            if (!linea) continue;
            const f = JSON.parse(linea) as Frame;
            yield f;
            if (f.t === "end") {
              acabado = true;
              return;
            }
          }
        }
      } catch (e) {
        acabado = true;
        if (ac.signal.aborted) {
          yield { t: "error", kind: "timeout" };
          return;
        }
        yield { t: "error", kind: "uncaught", message: mensaje(e) };
        yield { t: "end", ms: 0 };
        return;
      } finally {
        if (!acabado) await reader.cancel().catch(() => undefined);
      }
      // Cortado a mitad: por ejemplo, se acabó la CPU tras empezar a responder.
      yield { t: "error", kind: "uncaught", message: "the function stopped before finishing" };
      yield { t: "end", ms: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
