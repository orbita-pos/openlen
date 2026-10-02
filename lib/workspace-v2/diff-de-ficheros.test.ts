// lib/workspace-v2/diff-de-ficheros.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { diffDeFichero, filasLadoALado, lineasDe, type DiffDeFichero } from "./diff-de-ficheros";

const n = (k: number) => Array.from({ length: k }, (_, i) => `l${i + 1}`);
const texto = (ls: string[]) => `${ls.join("\n")}\n`;

/** El diff en una línea por fila, para leerlo de un vistazo. */
function plano(d: DiffDeFichero): string[] {
  const out: string[] = [];
  for (const t of d.trozos) {
    if (t.saltadas) out.push(`··· ${t.saltadas}`);
    for (const l of t.lineas) out.push(`${l.tipo === "igual" ? " " : l.tipo === "quitada" ? "-" : "+"}${l.antes ?? "_"}/${l.despues ?? "_"} ${l.texto}`);
  }
  if (d.saltadasAlFinal) out.push(`··· ${d.saltadasAlFinal}`);
  return out;
}

describe("lineasDe", () => {
  it("un salto final termina la última línea; vacío o inexistente, ninguna", () => {
    expect(lineasDe("a\nb\n")).toEqual(["a", "b"]);
    expect(lineasDe("a\n\nb")).toEqual(["a", "", "b"]);
    expect(lineasDe("")).toEqual([]);
    expect(lineasDe(null)).toEqual([]);
  });
});

describe("diffDeFichero — trozos con 3 líneas de contexto, como DeepSeek", () => {
  it("una línea cambiada en medio de 20: su contexto, y lo demás plegado", () => {
    const antes = n(20);
    const despues = [...antes];
    despues[9] = "NUEVA";
    const d = diffDeFichero(texto(antes), texto(despues));
    expect(d.quitadas).toBe(1);
    expect(d.anadidas).toBe(1);
    expect(plano(d)).toEqual([
      "··· 6",
      " 7/7 l7",
      " 8/8 l8",
      " 9/9 l9",
      "-10/_ l10",
      "+_/10 NUEVA",
      " 11/11 l11",
      " 12/12 l12",
      " 13/13 l13",
      "··· 7",
    ]);
  });

  it("dos cambios lejos son dos trozos; cerca, uno solo", () => {
    const lejos = n(30);
    lejos[2] = "A";
    lejos[25] = "B";
    expect(diffDeFichero(texto(n(30)), texto(lejos)).trozos).toHaveLength(2);
    const cerca = n(30);
    cerca[10] = "A";
    cerca[15] = "B";
    expect(diffDeFichero(texto(n(30)), texto(cerca)).trozos).toHaveLength(1);
  });

  it("los números siguen bien tras una línea añadida", () => {
    const despues = n(10);
    despues.splice(2, 0, "metida");
    expect(plano(diffDeFichero(texto(n(10)), texto(despues)))).toEqual([
      " 1/1 l1",
      " 2/2 l2",
      "+_/3 metida",
      " 3/4 l3",
      " 4/5 l4",
      " 5/6 l5",
      "··· 5",
    ]);
  });

  it("un fichero nuevo es todo añadido; uno borrado, todo quitado", () => {
    const nuevo = diffDeFichero(null, "a\nb\n");
    expect([nuevo.anadidas, nuevo.quitadas]).toEqual([2, 0]);
    expect(plano(nuevo)).toEqual(["+_/1 a", "+_/2 b"]);
    const borrado = diffDeFichero("a\nb\n", null);
    expect([borrado.anadidas, borrado.quitadas]).toEqual([0, 2]);
  });

  it("una línea editada dos veces en el turno cuenta una: se compara el principio con el final", () => {
    const d = diffDeFichero("x\n", "z\n");
    expect([d.anadidas, d.quitadas]).toEqual([1, 1]);
  });
});

describe("filasLadoALado", () => {
  it("cada tanda de quitadas, emparejada con las añadidas que la siguen", () => {
    const d = diffDeFichero("a\nb\nc\nd\n", "a\nB\nC\nX\nd\n");
    const filas = filasLadoALado(d.trozos[0]!.lineas).map(
      (f) => `${f.izquierda?.texto ?? "·"} | ${f.derecha?.texto ?? "·"}`,
    );
    expect(filas).toEqual(["a | a", "b | B", "c | C", "· | X", "d | d"]);
  });
});
