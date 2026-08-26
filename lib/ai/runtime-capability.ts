/**
 * Autoridad para MUTAR el JavaScript del modelo en el documento activo.
 *
 * Este módulo no importa Node, parsers ni código de servidor: catálogo,
 * contexto, rutas y herramientas consumen exactamente la misma decisión.
 */
export type RuntimeMutationCapability =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "off" | "subpage" };

const ALLOWED: RuntimeMutationCapability = Object.freeze({ allowed: true });
const OFF: RuntimeMutationCapability = Object.freeze({ allowed: false, reason: "off" });
const SUBPAGE: RuntimeMutationCapability = Object.freeze({ allowed: false, reason: "subpage" });

/** Opt-in exacto + documento raíz. `undefined` conserva el contrato histórico
 * de Home; los slugs se validan antes de llegar aquí. */
export function runtimeMutationCapability(
  env: Readonly<Record<string, string | undefined>>,
  page: string | null | undefined,
): RuntimeMutationCapability {
  if (env.OPENLEN_MODEL_JS !== "1") return OFF;
  return page ? SUBPAGE : ALLOWED;
}

/** Recalcula al cambiar de documento dentro del turno sin volver a leer env.
 * Una decisión `off` nunca puede encenderse; las otras dos prueban que el flag
 * estaba ON y sólo cambia la condición Home/subpágina. */
export function runtimeCapabilityForPage(
  current: RuntimeMutationCapability,
  page: string | null | undefined,
): RuntimeMutationCapability {
  if (!current.allowed && current.reason === "off") return OFF;
  return page ? SUBPAGE : ALLOWED;
}

/** Vista del entorno para builders de prompt heredados que todavía consumen
 * `OPENLEN_MODEL_JS`. Una denegación fuerza exactamente la variante OFF. */
export function runtimePolicyEnv(
  env: Readonly<Record<string, string | undefined>>,
  capability: RuntimeMutationCapability,
): Readonly<Record<string, string | undefined>> {
  return capability.allowed ? env : { ...env, OPENLEN_MODEL_JS: "0" };
}

/** Texto base compartido por boundary y defensa en profundidad. */
export function runtimeMutationDeniedMessage(
  capability: RuntimeMutationCapability,
  page: string | null | undefined,
): string {
  if (!capability.allowed && capability.reason === "subpage") {
    return `el JavaScript del modelo sólo se puede cambiar en la HOME; la página activa es "${page ?? "desconocida"}"`;
  }
  return "el interruptor de JavaScript del modelo está apagado para este turno";
}
