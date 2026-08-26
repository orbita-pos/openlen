/**
 * ¿PUEDE ESTE TURNO TOCAR EL JAVASCRIPT DEL MODELO?
 *
 * Desde el 2026-08-25 la respuesta depende de UNA sola cosa: el interruptor.
 * Ni de la página, ni del número de páginas del sitio, ni del dominio que lo
 * sirve.
 *
 * LO QUE HABÍA ANTES, y por qué se fue. La cápsula ata el código a UN documento
 * exacto, y sólo existía UNA columna para guardarla, así que sólo la Home podía
 * llevar JavaScript. Eso se presentaba como una regla de producto —«el piloto es
 * un documento»— cuando en realidad era una limitación de almacenamiento.
 *
 * Y para el usuario era peor de lo que sonaba, MEDIDO: no es que `/precios` no
 * tuviera interactividad. Es que **en cuanto añadía una segunda página, la Home
 * también la perdía**, y un dominio propio la apagaba con una sola página. Tres
 * puertas que nadie veía desde fuera; el síntoma era «mi carrito dejó de
 * funcionar» sin nada en la consola.
 *
 * Ahora cada página guarda la suya en `projects.pageRuntimes` (ver
 * lib/projects/page-runtimes.ts) y el publicador autoriza documento a documento.
 *
 * Este módulo sigue existiendo —y sigue siendo la ÚNICA fuente— porque el
 * interruptor sí tiene que leerse igual en las cuatro capas: la ruta, el
 * catálogo, la herramienta y la persistencia. Que cada una lo leyera por su
 * cuenta fue exactamente el defecto del hallazgo 1.
 *
 * No importa Node, parsers ni código de servidor.
 */
export type RuntimeMutationCapability =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "off" };

const ALLOWED: RuntimeMutationCapability = Object.freeze({ allowed: true });
const OFF: RuntimeMutationCapability = Object.freeze({ allowed: false, reason: "off" });

/** Opt-in exacto: sólo el literal `"1"` enciende. Un valor raro no puede
 *  encender el piloto por parecerse a un sí. */
export function runtimeMutationCapability(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeMutationCapability {
  return env.OPENLEN_MODEL_JS === "1" ? ALLOWED : OFF;
}

/** Vista del entorno para builders de prompt heredados que todavía consumen
 * `OPENLEN_MODEL_JS`. Una denegación fuerza exactamente la variante OFF. */
export function runtimePolicyEnv(
  env: Readonly<Record<string, string | undefined>>,
  capability: RuntimeMutationCapability,
): Readonly<Record<string, string | undefined>> {
  return capability.allowed ? env : { ...env, OPENLEN_MODEL_JS: "0" };
}

/** El texto que ve el usuario cuando no se puede. Queda un solo motivo: si
 *  alguna vez vuelve a haber dos, esto vuelve a ramificar — pero mientras haya
 *  uno, inventar una distinción sería mentir sobre por qué. */
export function runtimeMutationDeniedMessage(): string {
  return "el interruptor de JavaScript del modelo está apagado para este turno";
}
