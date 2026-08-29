// ¿Qué credencial necesita ESTE turno?
//
// EL DEFECTO QUE ESTO CIERRA. Las tres superficies de IA abrían con la misma
// línea, escrita cuando Gemini era el único proveedor:
//
//     const PROVIDER = resolveAIProvider("gemini-flash");
//     if (!PROVIDER.key) return 500;
//
// Con DeepSeek escribiendo por defecto, eso significaba que Crear, Chat y Len
// devolvían 500 antes de intentar nada cuando faltaba —o se AGOTABA, que es una
// key de prepago— una credencial que el modelo que de verdad escribe la página
// no usaba. Un saldo de imágenes en cero tumbaba la creación entera.
//
// Y al revés, el mismo agujero por el otro lado: sin `FIREWORKS_API_KEY` las
// tres pasaban la puerta y el fallo aparecía a mitad del stream
// (`stopReason: { kind: "error", error: "missing_key" }`), que para el usuario
// es peor que un 500 limpio — ya está mirando la página nacer.
//
// DESDE EL 2026-08-28 SOLO HAY UNA CREDENCIAL POSIBLE. Con Gemini fuera, los
// dos papeles que quedan —DeepSeek y Qwen— viajan por Fireworks. Este módulo
// se queda igualmente: la puerta que comprueba la clave ANTES de abrir el
// stream es lo que arreglaba el defecto, y eso no depende de cuántos
// proveedores haya. Si mañana entra un cuarto papel con otra credencial, entra
// por aquí y no por tres sitios.

import { writerForTurn, type TurnWriter } from "./provider-switch";

export type VariableDeCredencial = "FIREWORKS_API_KEY";

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

const ETIQUETA: Record<TurnWriter, string> = {
  deepseek: "DeepSeek (Fireworks)",
  qwen: "Qwen (Fireworks)",
};

export function credencialDelTurno(
  env: Readonly<Record<string, string | undefined>> = process.env,
  hasImages = false,
): CredencialDelTurno {
  const writer = writerForTurn(hasImages);
  return {
    writer,
    variable: "FIREWORKS_API_KEY",
    key: env.FIREWORKS_API_KEY?.trim() || undefined,
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
