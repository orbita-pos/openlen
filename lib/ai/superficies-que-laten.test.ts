// NINGUNA SUPERFICIE DE IA PUEDE ABRIR UN STREAM MUDO.
//
// 🔴 EL CASO, medido en producción el 2026-09-15. Un turno del Agente se quedó
// dentro de una medición que no volvía. El stream siguió abierto sin mandar un
// byte, y a los 90 SEGUNDOS EXACTOS Caddy cortó la respuesta a medias:
//
//   18:08:10  última señal del turno
//   18:09:40  aborting with incomplete response · read tcp …:3000: i/o timeout
//
// El navegador llama a eso «network error» y el usuario entiende que se le ha
// caído internet. No se había caído nada. `read_timeout 90s` es el transporte
// de Caddy hacia Next (infra/caddy/Caddyfile) y no se negocia con él.
//
// 🔴 POR QUÉ UNA GUARDA DE FUENTE Y NO UNA PRUEBA DE LA RUTA. El mecanismo ya
// tiene la suya (`sse.test.ts`: que late, que se reinicia, que se apaga). Lo
// que esto vigila es otra cosa — que esté ENCHUFADO — y ese es exactamente el
// fallo que hubo: el latido existía en Crear desde antes, escrito a mano, y las
// otras dos superficies llevaban meses sin él sin que nada se pusiera rojo.
// Una capacidad que existe y no está cableada es la avería que este repo ya ha
// tenido varias veces con nombre propio.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..");

/** Toda ruta que abra un canal SSE. Si nace una cuarta, se añade AQUÍ. */
const SUPERFICIES = [
  "app/api/agent/route.ts",
  "app/api/templates/ai-design/route.ts",
  "app/api/generate/route.ts",
] as const;

/**
 * Crear no pasa `latidoMs`: late con su propio `setInterval`, escrito antes de
 * que la mecánica compartida existiera, y su `progress` lleva además la cuenta
 * de caracteres que el cliente PINTA (`use-generation.ts`). Cambiarlo por el
 * comentario compartido le quitaría esa señal a cambio de nada, así que queda
 * exento — pero exento de la FORMA, no de la regla: abajo se comprueba que
 * sigue latiendo.
 */
const EXENTAS = new Set<string>(["app/api/generate/route.ts"]);

const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

describe("las superficies de IA laten", () => {
  it("🔴 toda ruta que abre un canal SSE le pasa `latidoMs`", () => {
    const mudas = SUPERFICIES.filter((ruta) => {
      if (EXENTAS.has(ruta)) return false;
      const texto = fuente(ruta);
      // El canal se abre en una sola línea en las tres. Se busca la llamada
      // CON su opción, no las dos por separado: `sseChannel(controller)` a
      // secas es exactamente la firma que costó el turno.
      return !/sseChannel\(\s*controller\s*,\s*\{[^}]*latidoMs/.test(texto);
    });

    expect(mudas, "abre un stream que puede quedarse 90 s callado y que Caddy cortará").toEqual([]);
  });

  it("y la exenta late a su manera — exenta de la forma, no de la regla", () => {
    const texto = fuente("app/api/generate/route.ts");
    expect(texto, "Crear se quedó sin su keepalive propio y sin el compartido").toMatch(
      /keepalive\s*=\s*setInterval\(/,
    );
  });

  it("el intervalo deja margen de sobra antes del muro de 90 s del proxy", () => {
    // Un latido tan lento como el muro no es un latido, es una carrera. Seis
    // fallos seguidos antes de que corte es el margen que se eligió.
    for (const ruta of SUPERFICIES) {
      if (EXENTAS.has(ruta)) continue;
      const declaracion = /const LATIDO_MS = ([\d_]+);/.exec(fuente(ruta));
      expect(declaracion, `${ruta} no declara LATIDO_MS`).not.toBeNull();
      const ms = Number(declaracion![1]!.replace(/_/g, ""));
      expect(ms, `${ruta}: el latido tiene que caber seis veces en los 90 s`).toBeLessThanOrEqual(15_000);
      expect(ms, `${ruta}: un latido más rápido que esto es ruido`).toBeGreaterThanOrEqual(1_000);
    }
  });

  it("y el muro que se está esquivando sigue siendo el que creemos", () => {
    // 🔴 EL NÚMERO NO ES NUESTRO. Si alguien sube `read_timeout` en Caddy —o lo
    // baja— el margen de arriba deja de significar lo que dice. Que se entere
    // aquí y no en el chat de un usuario.
    const caddy = readFileSync(join(RAIZ, "infra", "caddy", "Caddyfile"), "utf8");
    expect(caddy, "cambió read_timeout: revisa LATIDO_MS en las superficies").toMatch(
      /read_timeout\s+90s/,
    );
  });
});
