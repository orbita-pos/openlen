import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * NINGUN FICHERO DE FUENTE PUEDE LLEVAR UN BYTE DE CONTROL CRUDO.
 *
 * POR QUE EXISTE. `grep` y ripgrep clasifican como BINARIO cualquier fichero
 * con un byte de control, y entonces contestan «Binary file X matches» sin
 * devolver ni una linea. El fichero sigue compilando, los tests siguen pasando
 * y todo funciona — lo unico que se rompe es la BUSQUEDA, en silencio.
 *
 * En este repo eso no es un detalle: la regla de trabajo es «comprobar antes de
 * afirmar, un grep cuesta 1 segundo». Un `lib/agent/loop.ts` de ~1.500 lineas
 * invisible a grep convierte esa regla en una trampa — la comprobacion sale
 * vacia y se lee como «no esta», que es la peor respuesta posible: no un error,
 * una respuesta EQUIVOCADA con aspecto de correcta.
 *
 * MEDIDO el 2026-09-04: eran CUATRO ficheros, no uno. `lib/agent/loop.ts`,
 * `lib/page-data/store.ts`, `lib/style-match/autofill/cache.ts` y el plan del
 * que salieron los tres. Los valores eran deliberados —centinelas que no pueden
 * chocar con un slug ni con un visitorId, y un separador de dominio dentro de
 * un sha256— y siguen siendo exactamente los mismos: lo unico que cambio es que
 * el fuente los escribe con su secuencia de escape en vez de con el byte.
 *
 * El origen fue escribir ficheros con heredocs que se comen las barras
 * invertidas, asi que reaparecera por la misma via. De ahi esta guarda.
 *
 * NOTA PARA QUIEN LA EDITE: este fichero no escribe NUNCA una secuencia de
 * escape ni un byte de control, ni siquiera dentro de una expresion regular o
 * de un comentario. Se compara por codigo de caracter a proposito. Al escribir
 * la guarda por primera vez, teclear el escape lo convirtio en el byte y el
 * fichero suspendio su propia prueba — dos veces.
 */

const TAB = 9;
const LF = 10;
const CR = 13;
const PRIMER_IMPRIMIBLE = 32;

/** Indice del primer byte de control, o -1. Tab, salto y retorno son legitimos. */
function primerControl(texto: string): number {
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c === TAB || c === LF || c === CR) continue;
    if (c < PRIMER_IMPRIMIBLE) return i;
  }
  return -1;
}

const RAICES = ["lib", "app", "components", "scripts", "tools", "messages"];
const EXTENSIONES = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".md"];
const SALTAR = new Set(["node_modules", ".next", "dist", "target", "coverage", ".git"]);

function ficherosDeFuente(raiz: string): string[] {
  let dentro: string[];
  try {
    dentro = readdirSync(raiz);
  } catch {
    return []; // una raiz que no existe no es un fallo
  }
  const salida: string[] = [];
  for (const nombre of dentro) {
    if (SALTAR.has(nombre)) continue;
    const ruta = join(raiz, nombre);
    let esDir = false;
    try {
      esDir = statSync(ruta).isDirectory();
    } catch {
      continue;
    }
    if (esDir) salida.push(...ficherosDeFuente(ruta));
    else if (EXTENSIONES.some((e) => nombre.endsWith(e))) salida.push(ruta);
  }
  return salida;
}

describe("el fuente no lleva bytes de control", () => {
  it("ningun fichero es invisible para grep", () => {
    const culpables: string[] = [];
    for (const raiz of RAICES) {
      for (const f of ficherosDeFuente(raiz)) {
        const texto = readFileSync(f, "utf8");
        const i = primerControl(texto);
        if (i === -1) continue;
        const linea = texto.slice(0, i).split("\n").length;
        const codigo = "0x" + texto.charCodeAt(i).toString(16).padStart(2, "0");
        culpables.push(`${f}:${linea} lleva ${codigo}`);
      }
    }

    // El mensaje dice el ARREGLO, no solo el fallo: quien lo vea por primera vez
    // no tiene por que saber que el valor se conserva escapandolo.
    expect(
      culpables,
      "Un byte de control crudo hace que grep trate el fichero ENTERO como " +
        "binario y no devuelva NINGUNA linea. Sustituyelo por su secuencia de " +
        "escape: el valor en ejecucion es identico y el fuente vuelve a ser " +
        "buscable.\n" +
        culpables.join("\n"),
    ).toEqual([]);
  });

  it("se mira de verdad una cantidad razonable de ficheros", () => {
    // Sin esto, un fallo del recorrido (una raiz renombrada, un permiso) dejaria
    // la prueba VERDE sin haber mirado nada — verde por no encontrar, no por
    // estar limpio. Es la trampa clasica de las guardas que afirman ausencia.
    const total = RAICES.reduce((n, r) => n + ficherosDeFuente(r).length, 0);
    expect(total).toBeGreaterThan(500);
  });
});
