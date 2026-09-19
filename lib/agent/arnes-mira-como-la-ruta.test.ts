// LOS OJOS DEL ARNÉS TIENEN QUE MIRAR LO MISMO QUE LOS DE LA RUTA.
//
// 🔴 POR QUÉ EXISTE, y no es una hipótesis: hasta el 2026-09-18 el arnés de
// evals llamaba a `verifyEditedPage` SIN `spec` y SIN `guardadas`, y mapeaba el
// veredicto a dos estados —`roto` o `bien`— tirando `observado` y `no_mirado`.
// O sea que una corrida medía un producto que no existe: uno donde las pruebas
// de comportamiento no se comprueban, las regresiones no se ven, y «no pude
// mirar» cuenta como aprobado.
//
// Es el hermano de `arnes-multiturno-como-la-ruta.test.ts`, que vigila las
// claves de `runAgentLoop`. Aquí se vigila la OTRA llamada, la de los ojos,
// porque la ceguera no estaba en qué se le pasa al bucle sino en qué se le pasa
// al que mira.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(import.meta.dirname, "..", "..");
const RUTA = join(RAIZ, "app", "api", "agent", "route.ts");
const ARNES = join(RAIZ, "lib", "agent", "evals", "harness.ts");

/** Quita comentarios y cadenas para que un `foo:` dentro de una frase no
 *  cuente como clave. Misma técnica que el guardia del arnés multiturno. */
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

/** Las claves de primer nivel del objeto que se le pasa a `verifyEditedPage`. */
function clavesDeLosOjos(src: string): Set<string> {
  const pelado = pelar(src);
  const abre = pelado.indexOf("verifyEditedPage({");
  expect(abre, "no se encontró la llamada a verifyEditedPage").toBeGreaterThan(-1);
  let i = abre + "verifyEditedPage(".length;
  let hondo = 0;
  const claves = new Set<string>();
  let linea = "";
  for (; i < pelado.length; i += 1) {
    const c = pelado[i]!;
    if (c === "{" || c === "(" || c === "[") hondo += 1;
    if (c === "}" || c === ")" || c === "]") {
      hondo -= 1;
      if (hondo === 0) break;
    }
    if (hondo === 1) {
      if (c === "," || c === "\n") {
        const m = /^\s*(?:\.\.\.\()?\s*([A-Za-z_$][\w$]*)\s*:/.exec(linea);
        if (m) claves.add(m[1]!);
        linea = "";
      } else linea += c;
    }
  }
  const m = /^\s*(?:\.\.\.\()?\s*([A-Za-z_$][\w$]*)\s*:/.exec(linea);
  if (m) claves.add(m[1]!);
  return claves;
}

describe("los ojos del arnés miran como los de la ruta", () => {
  const ruta = clavesDeLosOjos(readFileSync(RUTA, "utf8"));
  const arnes = clavesDeLosOjos(readFileSync(ARNES, "utf8"));

  it("🔴 el arnés pasa la promesa del turno y las promesas guardadas", () => {
    expect(arnes.has("spec"), "sin `spec` las pruebas de comportamiento no se comprueban").toBe(true);
    expect(arnes.has("guardadas"), "sin `guardadas` una regresión no se ve").toBe(true);
  });

  // Las tres que deciden QUÉ se mide. No es la lista entera de claves a
  // propósito: compararlas todas necesitaría entender propiedades abreviadas y
  // spreads con ternario —`...(gemelo ? { taggedHtml } : {})`—, o sea medio
  // analizador de TypeScript, y un guardia que se equivoca se acaba ignorando.
  // Éstas tres son las que cambian el veredicto; el resto es contexto.
  const LAS_QUE_DECIDEN = ["spec", "guardadas", "vista"] as const;

  it("🔴 pasa las tres que deciden qué se mide", () => {
    for (const clave of LAS_QUE_DECIDEN) {
      expect(arnes.has(clave), `el arnés no le pasa \`${clave}\` a los ojos`).toBe(true);
    }
  });

  // CONTRA-PRUEBA: si la RUTA dejara de pasar una de las tres, este guardia
  // estaría vigilando una paridad que ya no existe.
  it("CONTRA-PRUEBA: la ruta sigue pasando esas tres", () => {
    for (const clave of LAS_QUE_DECIDEN) {
      expect(ruta.has(clave), `la ruta ya no pasa \`${clave}\`: revisa este guardia`).toBe(true);
    }
  });

  it("🔴 mapea los CUATRO estados, no dos", () => {
    const src = readFileSync(ARNES, "utf8");
    for (const estado of ["no_mirado", "roto", "observado", "bien"]) {
      expect(src, `el arnés no mapea \`${estado}\``).toContain(`estado: "${estado}"`);
    }
    // Y las regresiones viajan con cualquiera de los cuatro.
    expect(src).toContain("conRegresiones");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Y EL MULTITURNO, que es donde una regresión PUEDE ocurrir.
//
// El arnés de evals da un turno: una promesa nace y ahí se acaba. Éste da
// varios, así que es el único sitio donde el turno 3 puede llevarse por delante
// lo que el turno 1 prometió — o sea, el único donde lo que construimos se
// puede medir de verdad.
describe("el arnés multiturno también", () => {
  const MULTITURNO = join(RAIZ, "scripts", "agent-multiturno.ts");
  const src = readFileSync(MULTITURNO, "utf8");
  const claves = clavesDeLosOjos(src);

  it("🔴 pasa la promesa del turno y las guardadas", () => {
    expect(claves.has("spec")).toBe(true);
    expect(claves.has("guardadas")).toBe(true);
  });

  // 🔴 LA SUITE VIVE FUERA DEL BUCLE DE TURNOS, que es toda la diferencia: si
  // se declarara dentro, cada turno empezaría sin memoria y una regresión no
  // podría existir. Se comprueba por posición porque es lo único que lo
  // distingue — el mismo `let` dos llaves más adentro no valdría.
  it("🔴 la suite cruza los turnos", () => {
    const declara = src.indexOf("let suiteDeLaPagina");
    const bucle = src.indexOf("for (const [i, prompt] of turnos.entries())");
    expect(declara, "no se declara la suite").toBeGreaterThan(-1);
    expect(declara, "la suite se declara DENTRO del bucle: no cruzaría turnos").toBeLessThan(bucle);
  });

  it("dice en la corrida lo que le pasó a la suite", () => {
    expect(src).toContain("[multiturno] suite tras el turno");
    expect(src).toContain("[multiturno] REGRESIÓN");
  });

  // DIVERGENCIA CONOCIDA, escrita para que no se confunda con un olvido: este
  // arnés no pasa `vista`, así que mide el documento pelado y no el que el
  // usuario ve (con la burbuja del chat). Es anterior a la suite y merece su
  // propio arreglo; listarla aquí impide que se convierta en costumbre.
  it("CONTRA-PRUEBA: `vista` sigue siendo la única divergencia con la ruta", () => {
    expect(claves.has("vista"), "si ya pasa `vista`, quita esta excusa").toBe(false);
  });
});
