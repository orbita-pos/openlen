// lib/expr/parse.ts — texto → AST, por descenso recursivo.
//
// Sin `eval`, sin `new Function`, sin dependencias. Corre en la puerta de
// ingestión (Node), así que una expresión rota se rechaza ANTES de guardarse:
// el visitante nunca ve una fórmula que no compila.
//
// El parser es la frontera de seguridad de todo L2. Lo que no sabe leer, no
// existe: no hay sintaxis para un bucle, ni para definir una función, ni para
// alcanzar el documento. Por eso el conjunto de nodos (types.ts) es cerrado y
// este archivo NUNCA cae en un caso "genérico".

import {
  FUNCTIONS,
  MAX_NODES,
  type Assignment,
  type BinaryOp,
  type FunctionName,
  type Node,
  type ParseResult,
} from "./types";

const NAME_RE = /^[a-z_][a-z0-9_]*$/i;

interface Token {
  readonly type: "num" | "text" | "name" | "op" | "(" | ")" | "," ;
  readonly value: string;
  readonly at: number;
}

/** Los de dos caracteres van primero: `<=` tiene que ganarle a `<`. */
const OPERATORS = ["!=", "<=", ">=", "=", "<", ">", "+", "-", "*", "/", "%"];
const WORD_OPS: Record<string, BinaryOp> = { Y: "Y", O: "O" };

function tokenize(src: string): { ok: true; tokens: Token[] } | { ok: false; error: { message: string; at: number } } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { i += 1; continue; }

    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const start = i;
      while (i < src.length && /[0-9.]/.test(src[i]!)) i += 1;
      const raw = src.slice(start, i);
      if ((raw.match(/\./g)?.length ?? 0) > 1) {
        return { ok: false, error: { message: `número mal escrito: ${raw}`, at: start } };
      }
      tokens.push({ type: "num", value: raw, at: start });
      continue;
    }

    if (c === '"' || c === "'") {
      const start = i;
      i += 1;
      let out = "";
      while (i < src.length && src[i] !== c) {
        // Sin escapes: un texto de una fórmula de página es una etiqueta corta,
        // y no tener escapes elimina toda una clase de ambigüedad.
        out += src[i];
        i += 1;
      }
      if (i >= src.length) return { ok: false, error: { message: "falta cerrar la comilla", at: start } };
      i += 1;
      tokens.push({ type: "text", value: out, at: start });
      continue;
    }

    if (/[a-z_]/i.test(c)) {
      const start = i;
      while (i < src.length && /[a-z0-9_]/i.test(src[i]!)) i += 1;
      tokens.push({ type: "name", value: src.slice(start, i), at: start });
      continue;
    }

    if (c === "(" || c === ")" || c === ",") {
      tokens.push({ type: c, value: c, at: i });
      i += 1;
      continue;
    }

    const op = OPERATORS.find((o) => src.startsWith(o, i));
    if (op) {
      tokens.push({ type: "op", value: op, at: i });
      i += op.length;
      continue;
    }

    return { ok: false, error: { message: `no entiendo "${c}"`, at: i } };
  }
  return { ok: true, tokens };
}

/** Precedencia, de menor a mayor. Cada nivel llama al siguiente. */
const LEVELS: readonly (readonly BinaryOp[])[] = [
  ["O"],
  ["Y"],
  ["=", "!=", "<", "<=", ">", ">="],
  ["+", "-"],
  ["*", "/", "%"],
];

export function parseExpression(src: string): ParseResult<Node> {
  const lexed = tokenize(src);
  if (!lexed.ok) return { ok: false, error: lexed.error };
  const tokens = lexed.tokens;
  if (tokens.length === 0) return { ok: false, error: { message: "la fórmula está vacía", at: 0 } };

  let pos = 0;
  let nodes = 0;
  let failure: { message: string; at: number } | null = null;

  const fail = (message: string, at: number): Node => {
    failure ??= { message, at };
    return { kind: "num", value: 0 };
  };
  const count = <T extends Node>(node: T): T => {
    nodes += 1;
    if (nodes > MAX_NODES) failure ??= { message: "la fórmula es demasiado larga", at: 0 };
    return node;
  };
  const peek = (): Token | undefined => tokens[pos];

  function parseLevel(level: number): Node {
    // `NO` liga lo más flojo posible: `NO 1 > 2` es "no (1 > 2)", no
    // "(no 1) > 2" — que daba `false > 2` = false y era una trampa silenciosa.
    if (level === 0) {
      const t = peek();
      if (t?.type === "name" && t.value.toUpperCase() === "NO") {
        pos += 1;
        return count({ kind: "not", arg: parseLevel(0) });
      }
    }
    if (level >= LEVELS.length) return parseUnary();
    let left = parseLevel(level + 1);
    for (;;) {
      const t = peek();
      if (!t) break;
      const op = t.type === "op" ? t.value : t.type === "name" ? WORD_OPS[t.value.toUpperCase()] : undefined;
      if (!op || !LEVELS[level]!.includes(op as BinaryOp)) break;
      pos += 1;
      const right = parseLevel(level + 1);
      left = count({ kind: "bin", op: op as BinaryOp, left, right });
    }
    return left;
  }

  function parseUnary(): Node {
    const t = peek();
    if (t?.type === "op" && t.value === "-") {
      pos += 1;
      return count({ kind: "neg", arg: parseUnary() });
    }
    return parsePrimary();
  }

  function parsePrimary(): Node {
    const t = peek();
    if (!t) return fail("la fórmula termina antes de tiempo", src.length);
    pos += 1;

    if (t.type === "num") return count({ kind: "num", value: Number(t.value) });
    if (t.type === "text") return count({ kind: "text", value: t.value });

    if (t.type === "(") {
      const inner = parseLevel(0);
      const close = peek();
      if (close?.type !== ")") return fail("falta cerrar el paréntesis", t.at);
      pos += 1;
      return inner;
    }

    if (t.type === "name") {
      const upper = t.value.toUpperCase();
      if (upper === "SI_NO" || upper === "VERDADERO") return count({ kind: "bool", value: true });
      if (upper === "FALSO") return count({ kind: "bool", value: false });

      // ¿Llamada a función? Sólo si el catálogo la tiene. Un nombre seguido de
      // paréntesis que no está en FUNCTIONS es un error, NUNCA una llamada a
      // algo del entorno — es la línea que impide alcanzar el navegador.
      if (peek()?.type === "(") {
        if (!(upper in FUNCTIONS)) {
          return fail(`no existe la función ${t.value}`, t.at);
        }
        pos += 1;
        const args: Node[] = [];
        if (peek()?.type !== ")") {
          for (;;) {
            args.push(parseLevel(0));
            if (peek()?.type === ",") { pos += 1; continue; }
            break;
          }
        }
        if (peek()?.type !== ")") return fail(`falta cerrar ${t.value}(`, t.at);
        pos += 1;
        const spec = FUNCTIONS[upper as FunctionName];
        if (args.length < spec.arity[0] || args.length > spec.arity[1]) {
          return fail(`${upper} no acepta ${args.length} argumento(s)`, t.at);
        }
        return count({ kind: "call", fn: upper as FunctionName, args });
      }

      if (!NAME_RE.test(t.value)) return fail(`nombre inválido: ${t.value}`, t.at);
      return count({ kind: "ref", name: t.value });
    }

    return fail(`no esperaba "${t.value}" aquí`, t.at);
  }

  const node = parseLevel(0);
  if (failure) return { ok: false, error: failure };
  if (pos < tokens.length) {
    return { ok: false, error: { message: `sobra "${tokens[pos]!.value}" al final`, at: tokens[pos]!.at } };
  }
  return { ok: true, node };
}

/** `nombre = expresión`, la única forma de `data-ol-set`. */
export function parseAssignment(src: string): ParseResult<Assignment> {
  const eq = src.indexOf("=");
  if (eq === -1) return { ok: false, error: { message: "falta el = de la asignación", at: 0 } };
  const target = src.slice(0, eq).trim();
  if (!NAME_RE.test(target)) {
    return { ok: false, error: { message: `nombre inválido a la izquierda del =: "${target}"`, at: 0 } };
  }
  const value = parseExpression(src.slice(eq + 1));
  if (!value.ok) return { ok: false, error: { ...value.error, at: value.error.at + eq + 1 } };
  return { ok: true, node: { target, value: value.node } };
}

/** Todo nombre que la expresión LEE. Con esto la puerta detecta una fórmula que
 *  referencia un valor que no existe en la página — nace muerta, igual que un
 *  control mal cableado. */
export function referencedNames(node: Node, out: Set<string> = new Set()): Set<string> {
  switch (node.kind) {
    case "ref": out.add(node.name); break;
    case "not": case "neg": referencedNames(node.arg, out); break;
    case "bin": referencedNames(node.left, out); referencedNames(node.right, out); break;
    case "call": for (const a of node.args) referencedNames(a, out); break;
    default: break;
  }
  return out;
}
