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
//   "!"         negación lógica · "~" negación aritmética
//   "@SUMA:3"   llama SUMA con 3 argumentos
//   "?7"        si la cima es falsa, salta 7 instrucciones
//   "j3"        salta 3 instrucciones (NO ">": chocaría con el operador)
//
// El sigilo va delante para que la máquina decida con `charAt(0)`, que es lo
// más barato que se puede escribir.

import type { Assignment, Node } from "./types";

export type Program = readonly (string | number | boolean)[];

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
  const out: (string | number | boolean)[] = [];
  emit(node, out);
  return out;
}

export function compileAssignment(a: Assignment): { target: string; program: Program } {
  return { target: a.target, program: compile(a.value) };
}

function emit(n: Node, out: (string | number | boolean)[]): void {
  switch (n.kind) {
    case "num": out.push(n.value); return;
    case "bool": out.push(n.value); return;
    case "text": out.push(`'${n.value}`); return;
    case "ref": out.push(`$${n.name}`); return;
    case "neg": emit(n.arg, out); out.push("~"); return;
    case "not": emit(n.arg, out); out.push("!"); return;

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
      for (const a of n.args) emit(a, out);
      out.push(`@${n.fn}:${n.args.length}`);
      return;
    }
  }
}
