// lib/functions/after-write.ts — LO QUE NO COMPILA DE LAS FUNCIONES, DE VUELTA A
// LEN EN EL ACTO (spec local 2026-10-11, Parte 1), como `compila-la-app.ts` con
// las apps: tras una herramienta que tocó /supabase/functions/** o config.toml,
// se despliega el borrador (en serie, con lo ya guardado) y lo que diga el
// empaquetador va al `<new-diagnostics>` de la tanda. Puro.

import type { Diagnostico } from "@/lib/agent/diagnosticos";

import type { DeployOutcome } from "./deploy-core";
import { isFunctionsInputPath } from "./project-files";

export async function functionDiagnosticsAfterWrite(written: readonly string[], deploy: () => Promise<DeployOutcome>): Promise<Diagnostico[]> {
  if (!written.some(isFunctionsInputPath)) return [];
  const r = await deploy();
  if (r.kind === "failed") return [...r.errors, ...r.warnings];
  if (r.kind === "engine_error") {
    return [{ ruta: "/supabase/functions/", linea: 1, columna: 1, gravedad: "Error", mensaje: `The Edge Functions could not be deployed: ${r.message}`, codigo: "functions-deploy", fuente: "supabase" }];
  }
  if (r.kind === "deployed" || r.kind === "unchanged") return [...r.warnings];
  return [];
}
