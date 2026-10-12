// lib/functions/mask.ts — NINGÚN SECRETO VUELVE A LEN DE REBOTE (spec local
// 2026-10-11, Parte 4). Lo que sale de una función y Len puede leer —sus
// registros, sus errores, el cuerpo que ve el `curl` de la terminal— pasa por
// aquí: cada valor secreto del entorno se cambia por `[NOMBRE]`, como GitHub
// Actions. Son la clave secreta del proyecto (`SUPABASE_SERVICE_ROLE_KEY`) y los
// secretos del usuario de ese entorno (fase 2). Un valor de menos de 8
// caracteres no se tapa: taparía palabras corrientes. Puro.

/** Por debajo de esto un «secreto» taparía palabras corrientes. */
const MINIMO = 8;

export function maskSecrets(text: string, secrets: Readonly<Record<string, string>>): string {
  let out = text;
  const pares = Object.entries(secrets)
    .filter(([, v]) => v.length >= MINIMO)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [nombre, valor] of pares) out = out.split(valor).join(`[${nombre}]`);
  return out;
}

/** Un cuerpo que Len va a leer (el `curl` de la terminal): si es texto, tapado;
 *  si es binario, tal cual (tapar bytes lo rompería). */
export function maskBody(bytes: Buffer, secrets: Readonly<Record<string, string>>): Buffer {
  const texto = bytes.toString("utf8");
  return Buffer.from(texto, "utf8").equals(bytes) ? Buffer.from(maskSecrets(texto, secrets), "utf8") : bytes;
}
