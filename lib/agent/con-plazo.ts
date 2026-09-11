// lib/agent/con-plazo.ts — el `race` contra un plazo, EXTRAÍDO.
//
// Vivía inline en `getUserMemoryBounded` (`lib/agent/user-memory.ts`). Task 5
// (R11) necesitó el MISMO patrón para `getEsfuerzoGuardado` — otra lectura de
// una preferencia, antes del primer byte que ve el usuario, que no puede
// colgar ni tumbar el turno — y copiarlo habría sido la misma capacidad
// quedándose a medias en dos superficies, que es justo la razón que el
// comentario original ya daba para no repetirlo ni una vez más. Un sólo
// sitio; los dos llamadores lo usan.

/**
 * Corre `trabajo` contra un plazo de `ms`. Si gana el plazo, si `trabajo`
 * termina en error, o si CONSTRUIRLO revienta antes de devolver una promesa,
 * devuelve `siNo` — nunca deja que una base lenta o un fallo tumben al
 * llamador.
 *
 * `trabajo` es una FUNCIÓN, no una promesa ya en marcha: una promesa llega
 * aquí ya corriendo, así que nada de esta función puede vigilar su
 * construcción — un `trabajo` síncrono que revienta al llamarlo (antes de
 * que exista ninguna promesa que capturar) se escaparía por delante del
 * `try`. Con el pensón la llamada ocurre DENTRO.
 *
 * El temporizador se limpia SIEMPRE en el `finally`: sin eso sigue vivo
 * después de que el `race` ya se resolvió, y mantiene el proceso en pie — un
 * runner de pruebas se cuelga al terminar la suite.
 */
export async function conPlazo<T>(trabajo: () => Promise<T>, ms: number, siNo: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      trabajo(),
      new Promise<T>((resolve) => {
        t = setTimeout(() => resolve(siNo), ms);
      }),
    ]);
  } catch {
    return siNo;
  } finally {
    if (t) clearTimeout(t);
  }
}
