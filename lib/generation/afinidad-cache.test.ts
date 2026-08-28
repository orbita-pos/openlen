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
// No es una llamada suelta: crear una página son la escritura, la pasada de
// reparación y UNA MÁS POR SUBPÁGINA, todas con el mismo prompt de sistema.
// Eran N réplicas distintas para un prefijo compartido.
//
// El nombre `requestId` es la trampa: suena a identificador de traza, y por eso
// un valor aleatorio parecía correcto. Es afinidad.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repairGeneratedPage } from "./repair-pass";

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

describe("la reparación hereda la réplica de quien escribió la página", () => {
  it("manda la afinidad que le dan, no una al azar", async () => {
    const call = espia();
    await repairGeneratedPage(
      { html: PAGINA, runtime: null, defectos: ["algo"], brief: "b", afinidad: "u.usuario-7" },
      { call },
    );
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0].requestId).toBe("u.usuario-7");
  });

  it("sin afinidad sigue funcionando — no se rompe, sólo no comparte réplica", async () => {
    const call = espia();
    await repairGeneratedPage({ html: PAGINA, runtime: null, defectos: ["algo"], brief: "b" }, { call });
    expect(call.mock.calls[0][0].requestId).toMatch(/^generate\.repair\./);
  });

  it("dos usuarios distintos NO comparten réplica", async () => {
    const call = espia();
    for (const u of ["u.ana", "u.beto"]) {
      await repairGeneratedPage(
        { html: PAGINA, runtime: null, defectos: ["x"], brief: "b", afinidad: u },
        { call },
      );
    }
    expect(call.mock.calls.map((c) => c[0].requestId)).toEqual(["u.ana", "u.beto"]);
  });
});

// LA GUARDA DE VERDAD: que no vuelva a colarse un aleatorio en la ruta de
// creación. Es del tipo que lee el fuente porque el fallo no es un valor
// incorrecto — es un valor VÁLIDO que anula un descuento en silencio, y ninguna
// prueba de comportamiento lo notaría.
describe("ningún aleatorio en la afinidad de la ruta de creación", () => {
  const FICHEROS = [
    join("lib", "ai-stream", "generate.ts"),
    join("lib", "generation", "repair-pass.ts"),
  ];

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

  it("y la escritura pasa la afinidad del usuario", () => {
    const src = readFileSync(join(process.cwd(), "lib", "ai-stream", "generate.ts"), "utf8");
    // Las dos ramas de escritura (DeepSeek y Qwen) tienen que llevarla: son el
    // mismo prompt de sistema en espacios de caché distintos, pero cada uno
    // reutiliza el suyo.
    expect(src).toContain("createDeepSeekPageProvider(opts.operation, `u.${opts.userId}`)");
    expect(src).toContain("requestId: `u.${opts.userId}`");
  });
});
