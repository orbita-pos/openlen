// ¿Qué credencial necesita ESTE turno?
//
// EL DEFECTO QUE ESTO CIERRA. Las tres superficies de IA abrían con la misma
// línea, escrita cuando Gemini era el único proveedor:
//
//     const PROVIDER = resolveAIProvider("gemini-flash");
//     if (!PROVIDER.key) return 500;
//
// Desde que existe `provider-switch`, quien escribe por defecto es DeepSeek en
// Fireworks: `usesDeepSeek` sólo vuelve a Gemini con el literal `gemini`. Así
// que con Fireworks bien configurado y `GEMINI_API_KEY` ausente —o AGOTADA, que
// es una key de prepago— Crear, Chat y Len devuelven 500 antes de intentar
// nada, por una credencial que el modelo que de verdad escribe la página no
// usa. Un saldo de imágenes en cero tumbaba la creación entera.
//
// Y al revés, el mismo agujero por el otro lado: sin `FIREWORKS_API_KEY` las
// tres pasaban la puerta y el fallo aparecía a mitad del stream
// (`stopReason: { kind: "error", error: "missing_key" }`), que para el usuario
// es peor que un 500 limpio — ya está mirando la página nacer.
//
// LAS IMÁGENES NO CAMBIAN LA CREDENCIAL, y por eso esto no necesita saber si el
// turno las lleva: `writerForTurn` devuelve "gemini" si y sólo si el
// interruptor lo pide explícitamente; con imágenes elige Qwen, que viaja por
// Fireworks igual que DeepSeek. La prueba de al lado fija esa equivalencia — si
// mañana un escritor nuevo necesita una tercera credencial, falla ahí y no en
// producción.

import {
  writerForTurn,
  type ProviderSwitch,
  type TurnWriter,
} from "./provider-switch";

export type VariableDeCredencial = "GEMINI_API_KEY" | "FIREWORKS_API_KEY";

export interface CredencialDelTurno {
  /** Quién escribe DE VERDAD este turno. */
  readonly writer: TurnWriter;
  /** La variable de entorno que ese papel necesita. */
  readonly variable: VariableDeCredencial;
  /** Su valor, ya recortado. `undefined` si falta o está en blanco. */
  readonly key: string | undefined;
  /** Etiqueta para el mensaje de error y los diarios. */
  readonly label: string;
}

/** El transporte de cada papel. Gemini es el único que no va por Fireworks. */
const VARIABLE: Record<TurnWriter, VariableDeCredencial> = {
  gemini: "GEMINI_API_KEY",
  deepseek: "FIREWORKS_API_KEY",
  qwen: "FIREWORKS_API_KEY",
};

const ETIQUETA: Record<TurnWriter, string> = {
  gemini: "Gemini",
  deepseek: "DeepSeek (Fireworks)",
  qwen: "Qwen (Fireworks)",
};

export function credencialDelTurno(
  conmutador: ProviderSwitch,
  env: Readonly<Record<string, string | undefined>> = process.env,
  hasImages = false,
): CredencialDelTurno {
  const writer = writerForTurn(conmutador, hasImages, env);
  const variable = VARIABLE[writer];
  return {
    writer,
    variable,
    key: env[variable]?.trim() || undefined,
    label: ETIQUETA[writer],
  };
}

/**
 * El mensaje del 500 que corresponde, o `null` si el turno puede correr.
 *
 * Nombra la variable que falta: el mensaje anterior decía "Gemini 3.5 Flash API
 * key missing" incluso cuando lo ausente era Fireworks, y mandaba a quien
 * operaba la caja a recargar la key equivocada.
 */
export function faltaCredencial(credencial: CredencialDelTurno): string | null {
  return credencial.key
    ? null
    : `${credencial.label} API key missing — falta ${credencial.variable}`;
}
