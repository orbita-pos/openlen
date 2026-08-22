/**
 * ¿Corre DeepSeek o Gemini? Una regla, tres interruptores.
 *
 * La regla estaba escrita tres veces —`OPENLEN_GENERATE_PROVIDER`,
 * `OPENLEN_CHAT_PROVIDER`, `OPENLEN_AGENT_PROVIDER`— y las tres decían lo mismo
 * con tres formas distintas: **opt-out**, la ausencia significa DeepSeek, y
 * sólo el literal `gemini` (recortado, en minúsculas) vuelve atrás. Escrita una
 * vez, un interruptor nuevo no puede nacer con otra semántica.
 *
 * Los interruptores siguen siendo tres a propósito: apagar el Chat sin apagar
 * la creación es exactamente lo que se quiere poder hacer en producción, sin
 * volver a desplegar.
 */
export type ProviderSwitch =
  | "OPENLEN_GENERATE_PROVIDER"
  | "OPENLEN_CHAT_PROVIDER"
  | "OPENLEN_AGENT_PROVIDER";

export function usesDeepSeek(
  name: ProviderSwitch,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env[name]?.trim().toLowerCase() !== "gemini";
}

/**
 * Con imágenes adjuntas manda Gemini, corra lo que corra el interruptor: el
 * papel que razona en Fireworks no tiene ojos, y un turno con una imagen que
 * el modelo no puede ver es peor que un turno más caro.
 */
export function usesDeepSeekForTurn(
  name: ProviderSwitch,
  hasImages: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return !hasImages && usesDeepSeek(name, env);
}

/** Quién escribe DE VERDAD este turno. */
export type TurnWriter = "deepseek" | "qwen" | "gemini";

/**
 * TRES PAPELES, UNA REGLA.
 *
 * Antes eran dos y la imagen adjunta caía en Gemini, con este motivo: *"el papel
 * que razona en Fireworks no tiene ojos, y un turno con una imagen que el modelo
 * no puede ver es peor que un turno más caro"*. Cierto entonces, falso ahora:
 * **Qwen tiene ojos** y viaja por el mismo transporte. Gemini se queda para los
 * píxeles —generar y editar imágenes— y para nada más.
 *
 * El opt-out explícito (`…_PROVIDER=gemini`) sigue mandando sobre todo: es la
 * palanca de vuelta atrás y tiene que funcionar también con imágenes.
 */
export function writerForTurn(
  name: ProviderSwitch,
  hasImages: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env,
): TurnWriter {
  if (!usesDeepSeek(name, env)) return "gemini";
  return hasImages ? "qwen" : "deepseek";
}
