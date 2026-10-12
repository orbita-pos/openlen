// scripts/functions-cloudflare-setup.ts — prepara Cloudflare para las Edge
// Functions (infra/FUNCTIONS_RUNBOOK.md §6). Una vez, y se puede repetir (cambiar
// la clave del despachador es correrlo otra vez). Desde una máquina con el repo
// —en la caja no hay tsx—, con las variables en el entorno:
//
//   OPENLEN_CF_ACCOUNT_ID=… OPENLEN_CF_API_TOKEN=… OPENLEN_CF_NAMESPACE=openlen-functions \
//   OPENLEN_CF_DISPATCH_KEY=… npm run functions:cloudflare-setup
//
// Imprime la URL para OPENLEN_CF_DISPATCH_URL.

import { readFileSync } from "node:fs";
import path from "node:path";

import { setupCloudflare } from "../lib/functions/engines/cloudflare/setup";

async function main() {
  const v = (k: string) => (process.env[k] ?? "").trim();
  const faltan = ["OPENLEN_CF_ACCOUNT_ID", "OPENLEN_CF_API_TOKEN", "OPENLEN_CF_NAMESPACE", "OPENLEN_CF_DISPATCH_KEY"].filter((k) => !v(k));
  if (faltan.length > 0) {
    console.error(`[functions:cloudflare-setup] faltan ${faltan.join(", ")}`);
    process.exit(1);
  }
  const fuente = readFileSync(path.join(process.cwd(), "lib", "functions", "engines", "cloudflare", "dispatcher.mjs"), "utf8");
  const r = await setupCloudflare(
    { accountId: v("OPENLEN_CF_ACCOUNT_ID"), apiToken: v("OPENLEN_CF_API_TOKEN"), namespace: v("OPENLEN_CF_NAMESPACE"), dispatchKey: v("OPENLEN_CF_DISPATCH_KEY") },
    fuente,
  );
  console.log(`[functions:cloudflare-setup] namespace ${r.createdNamespace ? "creado" : "ya estaba"}; despachador subido.`);
  console.log(`OPENLEN_CF_DISPATCH_URL=${r.dispatchUrl}`);
}

main().catch((e: unknown) => {
  console.error("[functions:cloudflare-setup]", e instanceof Error ? e.message : e);
  process.exit(1);
});
