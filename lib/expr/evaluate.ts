// lib/expr/evaluate.ts — recorrer el AST, sin `eval`.
//
// Este evaluador corre en el SERVIDOR: al hornear, para escribir el resultado
// inicial dentro del elemento. Así una página con cálculo **nace con un número
// visible** aunque el runtime nunca corra (kill-switch, JS bloqueado, CSP), en
// vez de nacer con un hueco.
//
// El del navegador es otro —vive minificado dentro de la receta, con presupuesto
// de bytes— y por eso hay una prueba que exige que los dos den el MISMO
// resultado sobre el mismo AST. Dos implementaciones que se separan en silencio
// son la clase de fallo que este repo ya pagó con la telemetría de conductas.

import { FUNCTIONS, type FunctionName, type Node, type Value } from "./types";

export type Env = Readonly<Record<string, Value>>;

/** Sin excepciones: una fórmula rota en la página de alguien no puede tumbar el
 *  render. Devuelve el neutro y sigue. */
export function evaluate(node: Node, env: Env, random: () => number = Math.random): Value {
  switch (node.kind) {
    case "num": return node.value;
    case "text": return node.value;
    case "bool": return node.value;
    // Un nombre que no existe vale 0 — el neutro. Que la fórmula APUNTE a un
    // nombre inexistente lo detecta la puerta al ingerir, no aquí: aquí ya es
    // tarde y callarse es mejor que romper la página.
    case "ref": return env[node.name] ?? 0;
    case "neg": return -num(evaluate(node.arg, env, random));
    case "not": return !truthy(evaluate(node.arg, env, random));
    case "bin": return binary(node.op, node.left, node.right, env, random);
    case "call": return call(node.fn, node.args, env, random);
  }
}

function binary(op: string, l: Node, r: Node, env: Env, rnd: () => number): Value {
  // Cortocircuito: `Y`/`O` no evalúan el lado derecho si no hace falta, igual
  // que en una hoja de cálculo.
  if (op === "Y") return truthy(evaluate(l, env, rnd)) ? truthy(evaluate(r, env, rnd)) : false;
  if (op === "O") return truthy(evaluate(l, env, rnd)) ? true : truthy(evaluate(r, env, rnd));

  const a = evaluate(l, env, rnd);
  const b = evaluate(r, env, rnd);
  switch (op) {
    // `+` es SIEMPRE numérico, como en una hoja de cálculo. Que fuera
    // polimórfico —sumar números, unir textos— parecía cómodo y trae un defecto
    // invisible: el visitante teclea "1,200" en un campo, se guarda como texto,
    // `recibo * 0.7` funciona (el `*` coacciona) y `recibo + extra` concatena
    // "1,200" con "50". Dos operadores del mismo cálculo discrepando en
    // silencio. Unir texto es UNE(), y se ve.
    case "+": return num(a) + num(b);
    case "-": return num(a) - num(b);
    case "*": return num(a) * num(b);
    // Dividir entre cero da 0, no Infinity ni NaN: en la página de alguien un
    // "Infinity" es un defecto visible y un 0 es una casilla sin llenar.
    case "/": return num(b) === 0 ? 0 : num(a) / num(b);
    case "%": return num(b) === 0 ? 0 : num(a) % num(b);
    case "=": return same(a, b);
    case "!=": return !same(a, b);
    case "<": return num(a) < num(b);
    case "<=": return num(a) <= num(b);
    case ">": return num(a) > num(b);
    case ">=": return num(a) >= num(b);
    default: return 0;
  }
}

function call(fn: FunctionName, args: readonly Node[], env: Env, rnd: () => number): Value {
  // SI es perezoso: sólo evalúa la rama que gana. Sin esto, `SI(divisor = 0, 0,
  // total / divisor)` evaluaría igualmente la división.
  if (fn === "SI") {
    return truthy(evaluate(args[0]!, env, rnd))
      ? evaluate(args[1]!, env, rnd)
      : evaluate(args[2]!, env, rnd);
  }

  const v = args.map((a) => evaluate(a, env, rnd));

  switch (fn) {
    case "SUMA": return flat(v).reduce<number>((s, x) => s + num(x), 0);
    case "MIN": return Math.min(...flat(v).map(num));
    case "MAX": return Math.max(...flat(v).map(num));
    case "CUENTA": return Array.isArray(v[0]) ? v[0].length : flat(v).length;
    case "REDONDEA": {
      const d = v.length > 1 ? Math.max(0, Math.min(6, Math.trunc(num(v[1])))) : 0;
      const f = 10 ** d;
      return Math.round(num(v[0]) * f) / f;
    }
    case "AZAR": {
      // AZAR(lista) elige uno; AZAR(a, b) da un entero entre a y b.
      if (Array.isArray(v[0]) && v.length === 1) {
        const list = v[0];
        return list.length === 0 ? 0 : list[Math.floor(rnd() * list.length)]!;
      }
      const lo = Math.ceil(num(v[0]));
      const hi = v.length > 1 ? Math.floor(num(v[1])) : lo;
      return hi < lo ? lo : lo + Math.floor(rnd() * (hi - lo + 1));
    }
    case "TEXTO": return text(v[0]!);
    case "UNE": return v.map(text).join("");
    case "MONEDA": {
      const d = v.length > 1 ? Math.max(0, Math.min(6, Math.trunc(num(v[1])))) : 0;
      // Separador de miles con espacios finos no: un `toLocaleString` distinto
      // entre servidor y navegador daría dos textos para el mismo número, y la
      // prueba de acuerdo entre ambos evaluadores fallaría de forma aleatoria.
      return num(v[0]).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
    default: return 0;
  }
}

/** SUMA(1, 2) y SUMA(lista) son la misma cosa para quien escribe la fórmula. */
function flat(values: readonly Value[]): Value[] {
  const out: Value[] = [];
  for (const v of values) {
    if (Array.isArray(v)) out.push(...v);
    else out.push(v);
  }
  return out;
}

function num(v: Value): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (Array.isArray(v)) return v.length;
  // "1.234,50" y "$1,234.50" son lo que un visitante escribe de verdad.
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function text(v: Value): string {
  if (Array.isArray(v)) return v.map(text).join(", ");
  if (typeof v === "boolean") return v ? "sí" : "no";
  return String(v);
}

function truthy(v: Value): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  return v !== "";
}

function same(a: Value, b: Value): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return text(a) === text(b);
  if (typeof a === typeof b) return a === b;
  // Tipos distintos se comparan como texto: el visitante que escribe "10" en un
  // campo no distingue el número del texto, y la fórmula tampoco debería.
  return text(a) === text(b);
}

/** Los nombres del catálogo, para que el validador diga "no existe X" sin
 *  importar el parser entero. */
export const FUNCTION_NAMES = Object.keys(FUNCTIONS) as readonly FunctionName[];
