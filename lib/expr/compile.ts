// lib/expr/compile.ts — AST → programa postfijo plano.
//
// POR QUÉ POSTFIJO Y NO EL ÁRBOL. El evaluador del navegador vive dentro del
// presupuesto de bytes de una receta (700B; `tabs` tiene 937 por excepción). Un
// recorrido recursivo del árbol necesita el árbol entero en el atributo, una
// función recursiva y un `switch` por tipo de nodo. Una máquina de pila sobre un
// array plano es UN bucle y UN `switch`, sin recursión — y de regalo acota la
// ejecución por construcción: la longitud del programa es el límite, no la
// profundidad de la pila.
//
// EL FORMATO es JSON compacto porque también viaja en un atributo del HTML de
// cada página. Cada elemento del array es una instrucción:
//
//   12          empuja el número 12
//   true        empuja el booleano
//   "$recibo"   empuja el valor llamado `recibo`
//   "'hola"     empuja el texto "hola"
//   "*"         operador binario (saca dos, empuja uno)
//   "N"         negación lógica · "~" negación aritmética
//   "@SUMA:3"   llama SUMA con 3 argumentos
//   ["$CADA",5,">"]  un SUB-PROGRAMA: el cuerpo de una comprensión
//   "?7"        si la cima es falsa, salta 7 instrucciones
//   "j3"        salta 3 instrucciones (NO ">": chocaría con el operador)
//
// El sigilo va delante para que la máquina decida con `charAt(0)`, que es lo
// más barato que se puede escribir.

import { LAZY_FUNCTIONS, type Assignment, type Node } from "./types";

/** Un elemento puede ser un SUB-PROGRAMA (array anidado): el cuerpo de una
 *  comprensión, que se ejecuta una vez por elemento de la lista en vez de una
 *  sola vez como el resto. Sigue siendo JSON plano y viaja en el atributo. */
export type Program = readonly (string | number | boolean | Program)[];

/**
 * `SI` se compila a SALTOS, no a una llamada de tres argumentos.
 *
 * Con una llamada, la máquina evaluaría las tres ramas antes de elegir. Para
 * casi todo daría igual —el lenguaje es total: dividir entre cero da 0, un
 * nombre desconocido da 0, nada lanza— pero `AZAR` consumiría un número
 * aleatorio en la rama que pierde, y entonces el evaluador del servidor (que sí
 * es perezoso) y éste darían resultados distintos sobre la misma página. Dos
 * evaluadores que discrepan en silencio es exactamente el fallo que este repo
 * ya pagó una vez.
 */
export function compile(node: Node): Program {
  const out: Cell[] = [];
  emit(node, out);
  return out;
}

export function compileAssignment(a: Assignment): { target: string; program: Program } {
  return { target: a.target, program: compile(a.value) };
}

type Cell = string | number | boolean | Program;

function emit(n: Node, out: Cell[]): void {
  switch (n.kind) {
    case "num": out.push(n.value); return;
    case "bool": out.push(n.value); return;
    case "text": out.push(`'${n.value}`); return;
    case "ref": out.push(`$${n.name}`); return;
    case "neg": emit(n.arg, out); out.push("~"); return;
    // "N", NO "!" — la máquina decide con charAt(0), así que un sigilo que sea
    // PREFIJO de un operador se lo come: con "!" el operador "!=" se leía como
    // "niega la cima" y `a != b` daba cualquier cosa en el navegador mientras
    // el servidor daba lo correcto. Es la MISMA colisión que ya costó el sigilo
    // de salto (">" contra ">" y ">="). Hay una prueba estructural en
    // machine.test.ts que ahora lo impide para toda la familia.
    case "not": emit(n.arg, out); out.push("N"); return;

    case "bin": {
      // `Y` y `O` también cortocircuitan, por el mismo motivo que `SI`.
      // `Y` y `O` se compilan con los MISMOS saltos que `SI`, en vez de con
      // opcodes propios de duplicar y descartar: menos instrucciones en la
      // máquina, que es donde se paga el presupuesto de bytes.
      //   a Y b  ≡  SI(a, bool(b), falso)
      //   a O b  ≡  SI(a, cierto,  bool(b))
      if (n.op === "Y" || n.op === "O") {
        emit(n.left, out);
        out.push("?");
        const toElse = out.length - 1;
        if (n.op === "Y") { emit(n.right, out); out.push("b"); }
        else out.push(true);
        out.push("j");
        const toEnd = out.length - 1;
        out[toElse] = `?${out.length - toElse - 1}`;
        if (n.op === "Y") out.push(false);
        else { emit(n.right, out); out.push("b"); }
        out[toEnd] = `j${out.length - toEnd - 1}`;
        return;
      }
      emit(n.left, out);
      emit(n.right, out);
      out.push(n.op);
      return;
    }

    case "call": {
      if (n.fn === "SI") {
        emit(n.args[0]!, out);
        out.push("?");
        const toElse = out.length - 1;
        emit(n.args[1]!, out);
        out.push("j");
        const toEnd = out.length - 1;
        out[toElse] = `?${out.length - toElse - 1}`;
        emit(n.args[2]!, out);
        out[toEnd] = `j${out.length - toEnd - 1}`;
        return;
      }
      // Las comprensiones (TODOS/ALGUNO/CUENTA_SI/FILTRA) emiten su 2º
      // argumento como SUB-PROGRAMA en vez de en línea: es una condición que
      // se evalúa una vez POR ELEMENTO, con `CADA` ligado. Compilarla en línea
      // la evaluaría una sola vez, con `CADA` sin ligar — o sea, nada.
      //
      // La iteración la hace la máquina y está ACOTADA por el largo de la
      // lista: no hay `while`, ni recursión de usuario, y el número de vueltas
      // se conoce antes de empezar. Es la forma de CEL, y es la razón de que el
      // lenguaje siga sin ser Turing-completo.
      //
      // No se DESENROLLA en la ingestión a propósito: OpenLen ya tiene listas
      // que vienen de una Google Sheet (Datos Vivos), y desenrollar ataría la
      // fórmula al largo que la lista tenía el día que se ingirió — el día que
      // crezca, la página mentiría en silencio. `MAX_NODES` además reventaría
      // con cualquier lista mediana.
      if ((LAZY_FUNCTIONS as readonly string[]).includes(n.fn)) {
        emit(n.args[0]!, out);
        out.push(compile(n.args[1]!));
        out.push(`@${n.fn}:2`);
        return;
      }
      for (const a of n.args) emit(a, out);
      out.push(`@${n.fn}:${n.args.length}`);
      return;
    }
  }
}
