// lib/functions/engines/cloudflare/fake-cloudflare.ts — CLOUDFLARE DE MENTIRA
// PARA LAS PRUEBAS DE PUNTA A PUNTA (spec local 2026-10-12, Parte 8): la parte
// de la API que usa el motor (subir, etiquetas, secretos, borrar), en memoria;
// cada script corriendo en workerd DE VERDAD (miniflare); y el despachador DE
// VERDAD (dispatcher.mjs), con un namespace que encuentra los scripts por su
// nombre. Lo único que no simula son los límites de CPU (sólo el ensayo real).

import type { CloudflareConfig } from "../cloudflare-api";
import dispatcher, { type DispatcherEnv } from "./dispatcher.mjs";
import { loadMiniflare, scriptOptions, type MiniflareLike } from "./miniflare-for-tests";

export const FAKE_CONFIG: CloudflareConfig = {
  accountId: "acc-prueba",
  apiToken: "tok-prueba",
  namespace: "openlen-functions",
  dispatchUrl: "https://openlen-dispatch.prueba.workers.dev/",
  dispatchKey: "clave-del-despachador",
};

interface Script {
  files: Record<string, string>;
  vars: Record<string, string>;
  tags: string[];
  readonly mf: MiniflareLike;
}

const ok = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], result }), { headers: { "content-type": "application/json" } });
const noEsta = () => new Response(JSON.stringify({ success: false, errors: [{ code: 10007, message: "This Worker does not exist on your account." }], result: null }), { status: 404 });

export function fakeCloudflare(): { fetch: typeof fetch; dispose(): Promise<void> } {
  const Miniflare = loadMiniflare();
  const scripts = new Map<string, Script>();
  const prefijo = `/client/v4/accounts/${FAKE_CONFIG.accountId}/workers/dispatch/namespaces/${FAKE_CONFIG.namespace}/scripts/`;

  async function api(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(prefijo)) return new Response("no", { status: 404 });
    const [nombre = "", que, cual] = url.pathname.slice(prefijo.length).split("/").map(decodeURIComponent);
    const s = scripts.get(nombre);
    if (req.method === "PUT" && !que) {
      const form = await req.formData();
      const meta = JSON.parse(await (form.get("metadata") as Blob).text()) as { bindings: { name: string; text: string }[]; tags: string[] };
      const files: Record<string, string> = {};
      for (const [k, v] of form) if (k !== "metadata") files[k] = await (v as Blob).text();
      const vars = Object.fromEntries(meta.bindings.map((b) => [b.name, b.text]));
      if (s) {
        await s.mf.setOptions(scriptOptions(files, vars));
        Object.assign(s, { files, vars, tags: meta.tags });
      } else {
        scripts.set(nombre, { files, vars, tags: meta.tags, mf: new Miniflare(scriptOptions(files, vars)) });
      }
      return ok({});
    }
    if (!s) return noEsta();
    if (req.method === "DELETE" && !que) {
      scripts.delete(nombre);
      await s.mf.dispose();
      return ok(null);
    }
    if (req.method === "GET" && que === "tags") return ok(s.tags);
    if (que === "secrets") {
      if (req.method === "GET") return ok(Object.keys(s.vars).map((name) => ({ name, type: "secret_text" })));
      if (req.method === "PUT") {
        const b = (await req.json()) as { name: string; text: string };
        s.vars = { ...s.vars, [b.name]: b.text };
      } else if (req.method === "DELETE" && cual) {
        s.vars = Object.fromEntries(Object.entries(s.vars).filter(([k]) => k !== cual));
      }
      await s.mf.setOptions(scriptOptions(s.files, s.vars));
      return ok(null);
    }
    return new Response("no", { status: 405 });
  }

  const env: DispatcherEnv = {
    DISPATCH_KEY: FAKE_CONFIG.dispatchKey,
    DISPATCHER: {
      get(name) {
        return {
          fetch(input, init) {
            const s = scripts.get(name);
            return s ? s.mf.dispatchFetch(input, init) : Promise.reject(new Error(`Worker not found: ${name}`));
          },
        };
      },
    },
  };

  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith(FAKE_CONFIG.dispatchUrl)) return dispatcher.fetch(req, env);
    if (req.url.startsWith("https://api.cloudflare.com/")) return api(req);
    throw new TypeError(`fetch failed: ${req.url}`);
  }) as typeof fetch;

  return {
    fetch: f,
    async dispose() {
      for (const s of scripts.values()) await s.mf.dispose();
      scripts.clear();
    },
  };
}
