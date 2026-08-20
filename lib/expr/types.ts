// lib/expr/types.ts — el AST del mini-lenguaje de L2.
//
// Lo que NO existe aquí es la mitad del diseño: no hay nodo de bucle, ni de
// función definida por el usuario, ni de acceso a propiedad, ni de llamada a
// algo que no esté en el catálogo. Una página no puede colgarse ni salirse de
// su propio documento porque **no hay forma de escribirlo**, no porque un
// guardia lo impida.
//
// Datos puros: sin I/O, sin nativo, sin DOM. El parser corre en la puerta de
// ingestión (Node) y el evaluador en el navegador del visitante, así que este
// archivo tiene que ser válido en los dos.

/** Los cuatro tipos. Vacío devuelve el neutro del suyo — un campo sin llenar
 *  vale 0, no revienta. La inferencia de tipos es lo que hace que las piezas
 *  compongan (la lección de Notion). */
export type ValueType = "number" | "text" | "boolean" | "list";

export type Value = number | string | boolean | readonly Value[];

/** El catálogo cerrado. Nombres de TAREA, no de programación: quien quiere
 *  sumar recibe SUMA, no un contador y un bucle (Nardi, MIT).
 *
 * Añadir una función aquí es un contrato PARA SIEMPRE — queda escrita en
 * documentos de usuarios que ya publicaron. Se añade con la misma vara que una
 * conducta: demanda medida, no "se nos ocurrió".
 */
export const FUNCTIONS = {
  SUMA: { arity: [1, Infinity], returns: "number" },
  MIN: { arity: [1, Infinity], returns: "number" },
  MAX: { arity: [1, Infinity], returns: "number" },
  REDONDEA: { arity: [1, 2], returns: "number" },
  CUENTA: { arity: [1, 1], returns: "number" },
  /** SI(condición, entonces, si_no) — el único condicional. */
  SI: { arity: [3, 3], returns: "any" },
  /** AZAR(lista) elige un elemento; AZAR(a, b) da un entero entre a y b. */
  AZAR: { arity: [1, 2], returns: "any" },
  TEXTO: { arity: [1, 1], returns: "text" },
  /** UNE("Ahorras ", total, " al mes") — unir texto es explícito porque `+` es
   *  siempre numérico. */
  UNE: { arity: [1, Infinity], returns: "text" },
  MONEDA: { arity: [1, 2], returns: "text" },

  // ── listas por posición ──────────────────────────────────────────────────
  // Con dos listas ALINEADAS (una de nombres, otra de precios) se arma un
  // carrito o un catálogo sin necesidad de objetos ni de acceso a propiedades
  // — que este archivo prohíbe a propósito. La posición es la que une.
  //
  // 1-BASED, no 0: quien escribe estas fórmulas no programa, y "el primero es
  // el 1" es lo que espera. Es la misma elección que hizo la hoja de cálculo.
  /** ELEMENTO(lista, 2) — el segundo. Fuera de rango da el neutro. */
  ELEMENTO: { arity: [2, 2], returns: "any" },
  /** POSICION(lista, valor) — en qué lugar está, o 0 si no está. */
  POSICION: { arity: [2, 2], returns: "number" },

  // ── comprensiones ACOTADAS ───────────────────────────────────────────────
  // La forma la toma prestada de CEL (Google): `all`, `exists`, `filter` no son
  // bucles del lenguaje, son iteración ACOTADA POR EL LARGO DE LA LISTA. El
  // resultado sigue sin ser Turing-completo — que es la garantía de verdad, no
  // el "no hay bucles" que yo había escrito antes.
  //
  // El segundo argumento es una CONDICIÓN, no un valor: se evalúa una vez por
  // elemento con `CADA` ligado al elemento en curso. Por eso estas cuatro son
  // PEREZOSAS y el compilador las emite como sub-programa (ver compile.ts).
  /** TODOS(precios, CADA > 100) */
  TODOS: { arity: [2, 2], returns: "boolean", lazy: true },
  /** ALGUNO(inscritos, CADA = mi_nombre) */
  ALGUNO: { arity: [2, 2], returns: "boolean", lazy: true },
  /** CUENTA_SI(respuestas, CADA = 'sí') */
  CUENTA_SI: { arity: [2, 2], returns: "number", lazy: true },
  /** SUMA(FILTRA(precios, CADA > 100)) */
  FILTRA: { arity: [2, 2], returns: "list", lazy: true },
} as const;

export type FunctionName = keyof typeof FUNCTIONS;

/**
 * El nombre que una comprensión LIGA al elemento en curso.
 *
 * Se eligió una palabra ligada en vez de inventar sintaxis de lambda
 * (`lista.all(x, x > 0)` de CEL) porque así el catálogo de nodos sigue cerrado
 * y la gramática NO crece: `CADA` es un `ref` como cualquier otro, y el
 * compilador es quien lo liga.
 *
 * Es RESERVADO: un `data-ol-val="CADA"` se rechaza al ingerir. Si no, la misma
 * fórmula significaría dos cosas según dónde esté.
 */
export const BOUND_NAME = "CADA";

/** Las funciones cuyo 2º argumento es una condición por elemento, no un valor.
 *  Derivado del catálogo — nunca una segunda lista que pueda quedarse vieja. */
export const LAZY_FUNCTIONS: readonly FunctionName[] = (
  Object.keys(FUNCTIONS) as FunctionName[]
).filter((n) => "lazy" in FUNCTIONS[n]);

export type BinaryOp =
  | "+" | "-" | "*" | "/" | "%"
  | "=" | "!=" | "<" | "<=" | ">" | ">="
  | "Y" | "O";

export type Node =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  /** Un valor con nombre — lo que el visitante escribió o eligió. La ÚNICA
   *  puerta por la que entra algo de fuera, y siempre por nombre declarado. */
  | { readonly kind: "ref"; readonly name: string }
  | { readonly kind: "not"; readonly arg: Node }
  | { readonly kind: "neg"; readonly arg: Node }
  | { readonly kind: "bin"; readonly op: BinaryOp; readonly left: Node; readonly right: Node }
  | { readonly kind: "call"; readonly fn: FunctionName; readonly args: readonly Node[] };

/** Una asignación: `elegido = AZAR(nombres)`. Sólo aparece en `data-ol-set`. */
export interface Assignment {
  readonly target: string;
  readonly value: Node;
}

export interface ParseError {
  readonly message: string;
  /** Posición en la expresión — para que el aviso señale el punto exacto. */
  readonly at: number;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly node: T }
  | { readonly ok: false; readonly error: ParseError };

/** Cuántos nodos puede tener una expresión. Una fórmula de una página cabe de
 *  sobra; el tope existe para que un documento hostil no haga trabajar al
 *  parser de la puerta de ingestión más de la cuenta. */
export const MAX_NODES = 128;
