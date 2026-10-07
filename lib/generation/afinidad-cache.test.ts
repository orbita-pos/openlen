// @vitest-environment node
//
// LA AFINIDAD DE CACHÉ NO PUEDE SER ALEATORIA.
//
// El cliente de Fireworks manda `requestId` en el campo `user` de la petición
// (`fireworks-stream-client.ts`: `user: request.requestId`). En el serverless de
// Fireworks la caché de prompt es POR RÉPLICA, y ese campo es lo que decide a
// cuál vas. Con `Math.random()` cada llamada aterrizaba en otra réplica, así que
// el prefijo —idéntico en todas— no se reutilizaba NUNCA.
//
// No es una llamada suelta: crear una página son varias vueltas del bucle de
// Len (antes, en Crear, la escritura y una más por subpágina), todas con el
// mismo prompt de sistema. Con un aleatorio eran N réplicas distintas para un
// prefijo compartido.
//
// El nombre `requestId` es la trampa: suena a identificador de traza, y por eso
// un valor aleatorio parecía correcto. Es afinidad.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Espía TIPADO: `vi.fn(async () => …)` infiere cero parámetros y entonces
 *  `mock.calls[0][0]` no compila. Declararlos es lo que deja mirar el
 *  requestId, que es lo único que estas pruebas miran. */
const espia = () =>
  vi.fn(async (_req: { requestId: string }) => ({
    ok: true as const,
    raw: "[]",
    usage: { inputTokens: 10, outputTokens: 5 },
  }));

const PAGINA = `<!doctype html><html lang="es"><head><title>x</title></head><body><h1 class="t">Hola</h1></body></html>`;

// ⚰️ RETIRADA con `repair-pass` el 2026-09-05. Probaba que la pasada de
// reparación heredase la afinidad de quien escribió la página, usando
// `repairGeneratedPage` como VEHÍCULO. Esa pasada se retiró de producción el
// 2026-09-04 y el módulo no tenía ya ningún importador: seguía viva sólo
// porque la sujetaban esta prueba y una puerta de despliegue.
//
// LA PROPIEDAD NO SE PIERDE — es la de abajo, y esa mira el fichero VIVO.

// LA GUARDA DE VERDAD: que no vuelva a colarse un aleatorio en la ruta de
// creación. Es del tipo que lee el fuente porque el fallo no es un valor
// incorrecto — es un valor VÁLIDO que anula un descuento en silencio, y ninguna
// prueba de comportamiento lo notaría.
describe("ningún aleatorio en la afinidad de la ruta de creación", () => {
  // Desde el 2026-10-06 crear es el primer mensaje a Len, así que la ruta de
  // creación es la de Len. ⚰️ Antes miraba `lib/ai-stream/generate.ts` (y antes
  // aún `repair-pass.ts`), que se fueron con Crear y con su pasada.
  const FICHEROS = [join("app", "api", "agent", "route.ts"), join("lib", "agent", "brain.ts")];

  it.each(FICHEROS)("%s no usa Math.random() como requestId sin alternativa", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    // Se permite como RESPALDO (`afinidad ?? \`...Math.random()...\``) — sin
    // afinidad hay que mandar algo. Lo que no se permite es que sea la única
    // opción: una línea `requestId:` que empiece por Math.random().
    for (const m of src.matchAll(/requestId:\s*([^,\n]*)/g)) {
      const valor = m[1];
      if (!valor.includes("Math.random()")) continue;
      expect(
        valor,
        `\`${rel}\` manda un requestId aleatorio SIN afinidad delante: eso lo lleva a ` +
          `una réplica distinta cada vez y la caché de prompt no acierta nunca`,
      ).toMatch(/\?\?/);
    }
  });

  it("y el turno de Len pasa una afinidad estable: la del proyecto", () => {
    const src = readFileSync(join(process.cwd(), "app", "api", "agent", "route.ts"), "utf8");
    // Todas las vueltas del bucle —y los turnos siguientes del mismo proyecto—
    // comparten el prefijo, así que van a la misma réplica. Lo que tiene que
    // sujetar es que sea estable y no un aleatorio; cuál exactamente (el
    // proyecto) no es asunto de esta guarda más allá de no ser aleatorio.
    // ⚰️ Aquí se afirmaba la del USUARIO en las dos ramas de escritura de
    // Crear (`u.${userId}`), que se fueron con él el 2026-10-06.
    expect(src).toContain("requestId: projectId");
  });
});
