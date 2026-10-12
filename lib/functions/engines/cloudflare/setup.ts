// lib/functions/engines/cloudflare/setup.ts — LA PUESTA EN MARCHA DE CLOUDFLARE
// (spec local 2026-10-12, Parte 7), una vez y repetible: el namespace de los
// scripts de los proyectos, el despachador con su vínculo y su clave, y su
// dirección workers.dev. La corre `npm run functions:cloudflare-setup`.

import {
  cfRequest,
  CloudflareApiError,
  COMPATIBILITY_DATE,
  COMPATIBILITY_FLAGS,
  DISPATCHER_SCRIPT,
  scriptForm,
  type CloudflareConfig,
  type Fetch,
} from "../cloudflare-api";

export async function setupCloudflare(
  cfg: Omit<CloudflareConfig, "dispatchUrl">,
  dispatcherSource: string,
  f: Fetch = fetch,
): Promise<{ readonly dispatchUrl: string; readonly createdNamespace: boolean }> {
  let createdNamespace = false;
  try {
    await cfRequest(cfg, f, "GET", `/workers/dispatch/namespaces/${encodeURIComponent(cfg.namespace)}`);
  } catch (e) {
    if (!(e instanceof CloudflareApiError && e.status === 404)) throw e;
    await cfRequest(cfg, f, "POST", "/workers/dispatch/namespaces", JSON.stringify({ name: cfg.namespace }), "application/json");
    createdNamespace = true;
  }
  const metadata = {
    main_module: "dispatcher.mjs",
    compatibility_date: COMPATIBILITY_DATE,
    compatibility_flags: [...COMPATIBILITY_FLAGS],
    bindings: [
      { type: "dispatch_namespace", name: "DISPATCHER", namespace: cfg.namespace },
      { type: "secret_text", name: "DISPATCH_KEY", text: cfg.dispatchKey },
    ],
  };
  await cfRequest(cfg, f, "PUT", `/workers/scripts/${DISPATCHER_SCRIPT}`, scriptForm(metadata, { "dispatcher.mjs": dispatcherSource }));
  await cfRequest(cfg, f, "POST", `/workers/scripts/${DISPATCHER_SCRIPT}/subdomain`, JSON.stringify({ enabled: true }), "application/json");
  const { subdomain } = await cfRequest<{ subdomain: string }>(cfg, f, "GET", "/workers/subdomain");
  return { dispatchUrl: `https://${DISPATCHER_SCRIPT}.${subdomain}.workers.dev/`, createdNamespace };
}
