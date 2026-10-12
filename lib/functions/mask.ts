// lib/functions/mask.ts — NINGÚN SECRETO VUELVE A LEN DE REBOTE (spec local
// 2026-10-11, Parte 4). Lo que sale de una función y Len puede leer —sus
// registros, sus errores, el cuerpo que ve el `curl` de la terminal— pasa por
// aquí: cada valor secreto del entorno se cambia por `[NOMBRE]`, como GitHub
// Actions. En la fase 1 el único es la clave secreta del proyecto
// (`SUPABASE_SERVICE_ROLE_KEY`); la fase 2 añade los del usuario. Puro.

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
