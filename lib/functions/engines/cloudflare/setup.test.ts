// @vitest-environment node
//
// LA PUESTA EN MARCHA DE CLOUDFLARE (spec local 2026-10-12, Parte 7) contra una
// API simulada: lo que pide, en orden, y lo que devuelve.
import { describe, expect, it } from "vitest";

import { setupCloudflare } from "./setup";

const CFG = { accountId: "acc1", apiToken: "tok", namespace: "openlen-functions", dispatchKey: "clave" };
const A = "https://api.cloudflare.com/client/v4/accounts/acc1";

type Llamada = { url: string; method: string; init: RequestInit };
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, errors: [], result }));
const mal = (status: number, message: string) => new Response(JSON.stringify({ success: false, errors: [{ message }], result: null }), { status });

function api(responder: (c: Llamada) => Response) {
  const llamadas: Llamada[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const c = { url: String(url), method: init.method ?? "GET", init };
    llamadas.push(c);
    return responder(c);
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

const SUBDOMINIO = (c: Llamada) => (c.url.endsWith("/workers/subdomain") ? ok({ subdomain: "openlen" }) : ok({}));

describe("setupCloudflare", () => {
  it("🔴 la primera vez: crea el namespace, sube el despachador con su vínculo y su clave, activa workers.dev y da la URL", async () => {
    const { f, llamadas } = api((c) => (c.method === "GET" && c.url.endsWith("/dispatch/namespaces/openlen-functions") ? mal(404, "not found") : SUBDOMINIO(c)));
    expect(await setupCloudflare(CFG, "export default {};", f)).toEqual({ dispatchUrl: "https://openlen-dispatch.openlen.workers.dev/", createdNamespace: true });
    expect(llamadas.map((c) => `${c.method} ${c.url.replace(A, "")}`)).toEqual([
      "GET /workers/dispatch/namespaces/openlen-functions",
      "POST /workers/dispatch/namespaces",
      "PUT /workers/scripts/openlen-dispatch",
      "POST /workers/scripts/openlen-dispatch/subdomain",
      "GET /workers/subdomain",
    ]);
    expect(JSON.parse(String(llamadas[1]!.init.body))).toEqual({ name: "openlen-functions" });
    const form = llamadas[2]!.init.body as FormData;
    expect(JSON.parse(await (form.get("metadata") as Blob).text())).toEqual({
      main_module: "dispatcher.mjs",
      compatibility_date: "2026-07-30",
      compatibility_flags: ["nodejs_compat"],
      bindings: [
        { type: "dispatch_namespace", name: "DISPATCHER", namespace: "openlen-functions" },
        { type: "secret_text", name: "DISPATCH_KEY", text: "clave" },
      ],
    });
    expect(await (form.get("dispatcher.mjs") as Blob).text()).toBe("export default {};");
    expect(JSON.parse(String(llamadas[3]!.init.body))).toEqual({ enabled: true });
  });

  it("la segunda: el namespace ya estaba y no se crea otra vez", async () => {
    const { f, llamadas } = api(SUBDOMINIO);
    expect((await setupCloudflare(CFG, "export default {};", f)).createdNamespace).toBe(false);
    expect(llamadas.some((c) => c.method === "POST" && c.url.endsWith("/dispatch/namespaces"))).toBe(false);
  });

  it("un fallo de la API se dice con su mensaje", async () => {
    await expect(setupCloudflare(CFG, "export default {};", api(() => mal(403, "Authentication error")).f)).rejects.toThrow("Authentication error");
  });
});
