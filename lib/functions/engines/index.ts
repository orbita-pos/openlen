// lib/functions/engines/index.ts — QUÉ MOTOR DE EDGE FUNCTIONS HAY EN ESTE
// SERVIDOR (spec local 2026-10-11). Sin motor, nada de las funciones corre: ni
// empaquetar al escribir, ni el estado, ni el `curl`, y /functions/v1 contesta
// 503. `lambda` llega en la fase 3: hasta entonces ese valor es «ninguno» (una
// palanca que no lleva a ninguna parte no se deja puesta).

import { backendConfigured } from "@/lib/backend/pg";

import { LocalEngine } from "./local";
import type { FunctionsEngine } from "./types";

let avisado = false;

export function configuredEngineName(env: Readonly<Record<string, string | undefined>> = process.env): "local" | null {
  if (env.OPENLEN_FUNCTIONS === "0") return null;
  const v = (env.OPENLEN_FUNCTIONS_ENGINE ?? "").trim();
  if (v === "local") {
    // El motor local corre código ajeno EN el proceso de la app.
    if (env.NODE_ENV === "production" && env.OPENLEN_FUNCTIONS_ALLOW_LOCAL_IN_PRODUCTION !== "1") return null;
    return "local";
  }
  if (v !== "" && !avisado) {
    avisado = true;
    console.warn(`[functions] OPENLEN_FUNCTIONS_ENGINE="${v}" no es un motor de este servidor: las Edge Functions quedan apagadas.`);
  }
  return null;
}

// UN MOTOR POR PROCESO, no por módulo: en desarrollo Next instancia este módulo
// una vez por ruta (medido en lib/agent/direcciones.ts), y la ruta de los
// secretos cambiaría las variables de un motor que la puerta no usa. En
// `globalThis`, como las direcciones de Len.
const CLAVE = Symbol.for("openlen.functions.engine");
type Global = typeof globalThis & { [CLAVE]?: FunctionsEngine | null };

export function functionsEngine(): FunctionsEngine | null {
  const g = globalThis as Global;
  if (!(CLAVE in g)) g[CLAVE] = configuredEngineName() === "local" ? new LocalEngine() : null;
  return g[CLAVE] ?? null;
}

/** Las funciones están encendidas: hay motor Y hay backend de las páginas. */
export function functionsEnabled(): boolean {
  return configuredEngineName() !== null && backendConfigured();
}
