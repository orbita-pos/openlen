// EL ARNÉS MULTITURNO TIENE QUE CABLEAR LO MISMO QUE LA RUTA.
//
// POR QUÉ EXISTE. La cabecera de `scripts/agent-multiturno.ts` presumía de
// conectar el bucle «como en producción» y se quedó atrás sin que nada se
// enterara: durante semanas NO enchufaba `medirParaElModelo`, así que el canal
// que le devuelve lo medido al MODELO simplemente no existía en el arnés. La
// consecuencia no fue académica — una corrida de pago del 2026-09-16 demostró
// que un aviso deja de salirle al USUARIO y NO pudo demostrar nada sobre lo que
// le llega al modelo, porque ahí ese canal estaba muerto.
//
// Una frase en un comentario no tiene compilador. Esto se lo pone: si la ruta
// empieza a pasarle al bucle algo que el arnés no pasa, esta prueba se pone
// roja y nombra la pieza.
//
// NO comprueba que las dos hagan LO MISMO con cada pieza —eso no lo puede ver
// un lector de texto—, sólo que el arnés no se deja ninguna sin cablear. Se
// enumera lo que cubre en vez de afirmar que todo va bien, como el informe de
// `preview` de Claude Code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..");
const RUTA = join(RAIZ, "app", "api", "agent", "route.ts");
const ARNES = join(RAIZ, "scripts", "agent-multiturno.ts");

// Piezas que la ruta pasa y el arnés NO, A PROPÓSITO. Cada una con su motivo:
// una lista sin motivos es un sitio donde esconder el próximo olvido.
const SOLO_DE_LA_RUTA: Record<string, string> = {
  // Lee la dirección que el NAVEGADOR del usuario tiene abierta (qué página
  // está mirando). En el arnés no hay navegador de usuario: corre siempre
  // sobre la Home y lo dice `lineaBase: { page: null }`.
  leerDireccion: "no hay navegador de usuario en el arnés",
  // Avisa al cliente por SSE de que el documento mutó, para que el taller
  // repinte. El arnés no tiene taller al otro lado del stream.
  onMutacion: "no hay cliente SSE al otro lado",
  // NB: los topes NO están aquí a propósito. La ruta dejó de pasarlos
  // (`topesPorPlan`: el tope de dinero es mensual), y esta misma prueba lo
  // cazó cuando se listaron de memoria — que es exactamente para lo que está
  // la comprobación de «la lista no se pudre».
};

/** Quita comentarios y literales de cadena, para que un `foo:` dentro de una
 *  frase o de una plantilla no cuente como clave. */
function pelar(src: string): string {
  let fuera = "";
  let i = 0;
  while (i < src.length) {
    const dos = src.slice(i, i + 2);
    if (dos === "//") {
      const fin = src.indexOf("\n", i);
      i = fin === -1 ? src.length : fin;
      continue;
    }
    if (dos === "/*") {
      const fin = src.indexOf("*/", i + 2);
      i = fin === -1 ? src.length : fin + 2;
      continue;
    }
    const c = src[i]!;
    if (c === '"' || c === "'" || c === "`") {
      i += 1;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i += 1;
      fuera += '""';
      continue;
    }
    fuera += c;
    i += 1;
  }
  return fuera;
}

/** Las claves de primer nivel del objeto que se le pasa a `runAgentLoop({…})`. */
function clavesDelBucle(src: string): Set<string> {
  const pelado = pelar(src);
  const abre = pelado.indexOf("runAgentLoop({");
  expect(abre, "no se encontró la llamada a runAgentLoop").toBeGreaterThan(-1);
  let i = abre + "runAgentLoop(".length;
  let hondo = 0;
  let fin = -1;
  for (; i < pelado.length; i++) {
    const c = pelado[i];
    if (c === "{" || c === "(" || c === "[") hondo += 1;
    else if (c === "}" || c === ")" || c === "]") {
      hondo -= 1;
      if (hondo === 0) {
        fin = i;
        break;
      }
    }
  }
  expect(fin, "la llamada a runAgentLoop no cierra").toBeGreaterThan(-1);
  const cuerpo = pelado.slice(abre + "runAgentLoop({".length, fin);

  // Una CLAVE es una palabra a nivel 0 precedida por `{` o `,` y seguida de
  // `:` o `(`. Lo de «precedida» no es adorno: sin ello el `undefined` de un
  // ternario (`cond ? undefined : …`) cuela como clave, porque su `:` a nivel 0
  // es indistinguible del de una propiedad. Lo cazó esta misma prueba.
  const claves = new Set<string>();
  let nivel = 0;
  let palabra = "";
  let antes = "{";
  for (let j = 0; j < cuerpo.length; j++) {
    const c = cuerpo[j]!;
    if (c === "{" || c === "(" || c === "[") nivel += 1;
    else if (c === "}" || c === ")" || c === "]") nivel -= 1;
    if (nivel !== 0) {
      palabra = "";
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      palabra += c;
      continue;
    }
    if (palabra && (antes === "{" || antes === ",")) {
      // `clave:`, el método corto `clave(`, y la forma corta `{ clave, }`.
      if (c === ":" || c === "(" || c === "," || c === "}") claves.add(palabra);
    }
    if (!/\s/.test(c)) antes = c;
    palabra = "";
  }
  return claves;
}

describe("el arnés multiturno cablea el bucle como la ruta", () => {
  const deLaRuta = clavesDelBucle(readFileSync(RUTA, "utf8"));
  const delArnes = clavesDelBucle(readFileSync(ARNES, "utf8"));

  it("la sonda discrimina: las dos llamadas se leyeron de verdad", () => {
    // BRAZO DE CONTROL. Sin esto, un parser que devolviera dos conjuntos
    // vacíos pasaría la prueba de abajo en verde sin haber mirado nada.
    expect(deLaRuta.size).toBeGreaterThan(5);
    expect(delArnes.size).toBeGreaterThan(5);
    expect(deLaRuta.has("runTool")).toBe(true);
    expect(delArnes.has("runTool")).toBe(true);
  });

  it("🔴 el arnés no se deja ninguna pieza de la ruta sin cablear", () => {
    const faltan = [...deLaRuta].filter((k) => !delArnes.has(k) && !(k in SOLO_DE_LA_RUTA));
    expect(
      faltan,
      `el arnés dice cablear el bucle «como en producción» y no pasa: ${faltan.join(", ")}. ` +
        "O se enchufa en scripts/agent-multiturno.ts, o entra en SOLO_DE_LA_RUTA con su motivo.",
    ).toEqual([]);
  });

  it("🔴 `medirParaElModelo` y su línea base están enchufados", () => {
    // La pieza concreta que faltaba, clavada aparte: es la que convierte una
    // corrida en prueba de que lo medido le llega AL MODELO.
    expect(delArnes.has("medirParaElModelo")).toBe(true);
    expect(delArnes.has("lineaBase")).toBe(true);
  });

  it("la lista de excepciones no se pudre: cada una sigue siendo de la ruta", () => {
    const sobran = Object.keys(SOLO_DE_LA_RUTA).filter((k) => !deLaRuta.has(k));
    expect(
      sobran,
      `SOLO_DE_LA_RUTA excusa piezas que la ruta ya no pasa: ${sobran.join(", ")}`,
    ).toEqual([]);
  });
});
