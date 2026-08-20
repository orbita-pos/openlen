import "server-only";

// lib/expr/document.ts — de una región `data-ol-calc` a una región compilada.
//
// Corre en la INGESTIÓN (`lib/page-engine/prepare.ts`), no al hornear. Ahí es
// donde una fórmula rota todavía se puede rechazar antes de guardarse, y donde
// el preview del editor y la publicación heredan el trabajo sin tocar nada:
// para cuando `bakeBehaviors` corre, el programa ya viaja en el atributo.
//
// La fórmula LEGIBLE se queda donde está — es lo que el Chat edita y lo que un
// humano entiende. Junto a ella va su gemelo compilado, que se **regenera en
// cada ingestión**, así que no puede quedarse rancio.

import { parse, type HTMLElement } from "node-html-parser";

import { compile, type Program } from "./compile";
import { evaluate } from "./evaluate";
import { parseAssignment, parseAssignments, parseExpression, referencedNames } from "./parse";
import { BOUND_NAME, type Node, type Value } from "./types";

export const REGION = "data-ol-calc";
export const VALUE = "data-ol-val";
export const OUT = "data-ol-out";
export const IF = "data-ol-if";
export const SET = "data-ol-set";
/** El estado que la región declara al nacer: `data-ol-state="n = 0; turno = 'X'"`.
 *
 *  Sin él, un `data-ol-set` cuyo destino no produce ningún campo queda
 *  bloqueado por la regla del gesto-no-ocurrido, y una condición sobre ese
 *  destino nace visible. Se podía desbloquear con un campo oculto —está
 *  medido— pero era un truco que nadie descubriría y que el prompt no enseña.
 *
 *  Los valores se evalúan AQUÍ, en la ingestión, y el gemelo lleva el
 *  resultado ya calculado: son valores INICIALES, no fórmulas vivas. */
export const STATE = "data-ol-state";
/** Cada hijo de un `data-ol-val` que sea una LISTA. La ruleta los necesita. */
export const ITEM = "data-ol-item";
/** El gemelo compilado de cada atributo con fórmula. */
export const compiledAttr = (attr: string): string => `${attr}-c`;

export interface CalcIssue {
  /** El atributo donde está la fórmula, para que el mensaje señale el sitio. */
  readonly attr: string;
  readonly formula: string;
  readonly message: string;
}

export interface CompileDocumentResult {
  readonly html: string;
  readonly regions: number;
  readonly compiled: number;
  readonly issues: readonly CalcIssue[];
}

/** Qué atributos de una región llevan fórmula, y cuáles son asignaciones. */
export const FORMULA_ATTRS: readonly { readonly attr: string; readonly assign: boolean }[] = [
  { attr: OUT, assign: false },
  { attr: IF, assign: false },
  { attr: SET, assign: true },
];

/**
 * Los nombres que viven en UNA región.
 *
 * `values` son los que el visitante produce (`data-ol-val`). `declared` añade
 * los destinos de las asignaciones — la ruleta escribe `elegido`, que ningún
 * campo del visitante produce, y una fórmula que lo lee NO está rota.
 *
 * Los dos conjuntos son distintos a propósito y cada uno decide una cosa:
 * `declared` decide si la fórmula está rota; `values` decide si la fórmula ya
 * se puede calcular al nacer (ver `readsUnset`).
 *
 * Exportada porque `lib/behaviors/validate.ts` la usa a través del `schema` de
 * la receta: si el validador tuviera su propia idea de "nombre declarado",
 * serían dos definiciones que pueden separarse en silencio.
 */
export interface RegionNames {
  readonly declared: ReadonlySet<string>;
  readonly values: ReadonlySet<string>;
}

export function collectRegionNames(
  region: HTMLElement,
  valueAttr: string = VALUE,
  assignAttrs: readonly string[] = [SET],
): RegionNames {
  const values = new Set<string>();
  for (const el of region.querySelectorAll(`[${valueAttr}]`)) {
    const name = el.getAttribute(valueAttr)?.trim();
    if (name) values.add(name);
  }
  // El estado declarado cuenta como VALOR, no sólo como declarado: existe desde
  // que la página nace, así que una fórmula que lo lee SÍ se puede calcular al
  // nacer (a diferencia del destino de un `set`, que espera un gesto).
  for (const el of [region, ...region.querySelectorAll(`[${STATE}]`)]) {
    const estado = parseAssignments(el.getAttribute(STATE) ?? "");
    if (estado.ok) for (const a of estado.node) values.add(a.target);
  }

  const declared = new Set(values);
  for (const attr of assignAttrs) {
    for (const el of region.querySelectorAll(`[${attr}]`)) {
      const a = parseAssignments(el.getAttribute(attr) ?? "");
      if (a.ok) for (const one of a.node) declared.add(one.target);
    }
  }
  return { declared, values };
}

/**
 * Los campos que NADIE lee — la otra mitad del "nace muerto".
 *
 * `checkFormula` comprueba que cada nombre que una fórmula LEE exista. Faltaba
 * el sentido contrario: un `data-ol-val` que ninguna fórmula usa es un control
 * que el visitante mueve y no hace nada.
 *
 * No es hipotético. La primera eval con briefs de cálculo (2026-08-20) lo cazó
 * a la primera: para la página de paneles solares el modelo emitió un campo
 * `recibo` Y un deslizador `recibo-range`, intentando tenerlos sincronizados.
 * El deslizador nacía muerto y todo lo determinista salía en verde, porque las
 * fórmulas SÍ compilaban.
 *
 * Es la misma simetría que `crossRefs` le añadió a `requiresHost`: uno
 * garantiza que el botón vive en su grupo; el otro, que el grupo apunta a algo.
 */
export function unreadValues(
  region: HTMLElement,
  valueAttr: string = VALUE,
  formulaAttrs: readonly { readonly attr: string; readonly assign?: boolean }[] = FORMULA_ATTRS,
): string[] {
  const leidos = new Set<string>();
  for (const { attr, assign } of formulaAttrs) {
    for (const el of region.querySelectorAll(`[${attr}]`)) {
      const raw = el.getAttribute(attr) ?? "";
      // `assign` viene del SCHEMA, no se adivina. Probar `parseAssignment`
      // primero era un bug: `=` es a la vez igualdad y asignación, así que
      // `data-ol-if="dia = 'sabado'"` parseaba como "asigna 'sabado' a dia" y
      // `dia` no contaba como leído — el campo quedaba acusado de muerto
      // estando vivo. Un falso positivo aquí es peor que el hueco que cierra:
      // haría a la puerta rechazar páginas correctas.
      if (assign) {
        const a = parseAssignments(raw);
        // Una fórmula que no parsea ya tiene su propio issue; se abandona el
        // barrido en vez de acusar de muertos a los campos que sí usaba.
        if (!a.ok) return [];
        for (const one of a.node) for (const n of referencedNames(one.value)) leidos.add(n);
        continue;
      }
      const parsed = parseExpression(raw);
      if (!parsed.ok) return [];
      for (const n of referencedNames(parsed.node)) leidos.add(n);
    }
  }
  const huerfanos: string[] = [];
  for (const el of region.querySelectorAll(`[${valueAttr}]`)) {
    const name = el.getAttribute(valueAttr)?.trim();
    if (name && !leidos.has(name) && !huerfanos.includes(name)) huerfanos.push(name);
  }
  return huerfanos;
}

/** El issue que produce un campo huérfano, con el mismo texto en los dos
 *  llamantes (el compilador de la ingestión y el validador de conductas). */
export function unreadIssue(name: string): CalcIssue {
  return {
    attr: VALUE,
    formula: name,
    message: `el campo "${name}" no lo lee ninguna fórmula de esta región — el visitante lo movería y no pasaría nada; úsalo en un ${OUT}/${IF}/${SET}, o quítale el ${VALUE}`,
  };
}

export type FormulaCheck =
  | { readonly ok: true; readonly node: Node; readonly target?: string }
  /** Varias asignaciones en un gesto: `c1 = t; t = SI(...)`. */
  | { readonly ok: true; readonly parts: readonly { target: string; node: Node }[] }
  | { readonly ok: false; readonly message: string };

/**
 * Parsea una fórmula y comprueba que todo nombre que LEE exista en la región.
 *
 * Un nombre que nadie produce es una fórmula que nace muerta: se detecta aquí,
 * mientras todavía se puede decir, y no en la página del visitante donde ya
 * sólo se ve un cero.
 */
export function checkFormula(
  raw: string,
  assign: boolean,
  declared: ReadonlySet<string>,
): FormulaCheck {
  if (assign) {
    const a = parseAssignments(raw);
    if (!a.ok) return { ok: false, message: a.error.message };
    for (const one of a.node) {
      const mal = unknownIn(one.value, declared);
      if (mal) return { ok: false, message: mal };
    }
    return { ok: true, parts: a.node.map((one) => ({ target: one.target, node: one.value })) };
  }
  const e = parseExpression(raw);
  if (!e.ok) return { ok: false, message: e.error.message };
  const mal = unknownIn(e.node, declared);
  return mal ? { ok: false, message: mal } : { ok: true, node: e.node };
}

/** El mensaje si la expresión lee algo que la región no tiene, o `null`. */
function unknownIn(node: Node, declared: ReadonlySet<string>): string | null {
  const desconocidos = [...referencedNames(node)].filter((n) => !declared.has(n));
  if (desconocidos.length === 0) return null;
  // `CADA` sólo existe DENTRO de una comprensión (referencedNames ya lo liga
  // ahí). Si llega hasta aquí es que alguien lo escribió suelto, y decirle
  // "declara un campo CADA" sería el consejo exactamente equivocado.
  if (desconocidos.includes(BOUND_NAME)) {
    return `usa "${BOUND_NAME}" fuera de una lista — ese nombre sólo existe dentro de TODOS/ALGUNO/CUENTA_SI/FILTRA, donde vale cada elemento`;
  }
  return `usa ${desconocidos.map((n) => `"${n}"`).join(", ")}, que no existe en esta región — declara un campo con ${VALUE}="${desconocidos[0]}"`;
}

/**
 * El entorno con el que la página NACE — leído del documento igual que el
 * runtime lo lee del DOM vivo.
 *
 * Evaluar con `{}` (lo que hacía antes) es la trampa fina de toda esta etapa:
 * `<input data-ol-val="recibo" value="1800">` con
 * `data-ol-out="REDONDEA(recibo * 0.72, 0)"` nacía diciendo **0**, y el
 * navegador decía 1296. Sin JS la página no mostraría un hueco: mostraría un
 * número FALSO — "ahorras 0" junto a un campo que dice 1800. Eso es la página
 * que MIENTE, que es peor que la página que perdió algo.
 *
 * Cada rama de aquí abajo tiene su gemela exacta en `E()` (recipes/calc.ts):
 * campo → su valor · casilla → booleano · radio → el marcado (o vacío) ·
 * `select` → la opción elegida · contenedor con `data-ol-item` → lista ·
 * cualquier otra cosa → su texto.
 */
function initialEnv(region: HTMLElement): Record<string, Value> {
  const env: Record<string, Value> = {};
  for (const el of region.querySelectorAll(`[${VALUE}]`)) {
    const name = el.getAttribute(VALUE)?.trim();
    if (!name) continue;
    const tag = el.tagName?.toLowerCase();
    const type = (el.getAttribute("type") ?? "").toLowerCase();

    if (type === "radio") {
      if (el.getAttribute("checked") !== undefined) env[name] = el.getAttribute("value") ?? "";
      else if (!(name in env)) env[name] = "";
      continue;
    }
    const items = el.querySelectorAll(`[${ITEM}]`);
    if (items.length > 0) {
      env[name] = items.map((it) => it.textContent.trim());
    } else if (type === "checkbox") {
      env[name] = el.getAttribute("checked") !== undefined;
    } else if (tag === "select") {
      // `.value` de un <select> es la opción con `selected`, o la primera.
      const opts = el.querySelectorAll("option");
      const chosen = opts.find((o) => o.getAttribute("selected") !== undefined) ?? opts[0];
      env[name] = chosen ? chosen.getAttribute("value") ?? chosen.textContent.trim() : "";
    } else if (tag === "input" || tag === "textarea") {
      env[name] = tag === "textarea" ? el.textContent : el.getAttribute("value") ?? "";
    } else {
      env[name] = el.textContent.trim();
    }
  }
  return env;
}

/**
 * ¿La fórmula depende de algo que todavía no ha pasado?
 *
 * `data-ol-out="elegido"` en la ruleta: `elegido` no lo produce ningún campo,
 * lo produce el clic. Calcularlo al nacer daría `0`, y una ruleta que dice "0"
 * antes de girar es exactamente la página muerta que este sistema existe para
 * impedir — así que se respeta el texto que el autor escribió ("—", "Gira para
 * elegir").
 *
 * El runtime aplica la MISMA regla barriendo el programa en busca de un
 * `$nombre` que no esté en el entorno (ver `recipes/calc.ts`). Dos reglas
 * distintas aquí serían dos evaluadores separándose en silencio.
 */
function readsUnset(node: Node, values: ReadonlySet<string>): boolean {
  return [...referencedNames(node)].some((n) => !values.has(n));
}

/**
 * Compila todas las regiones del documento.
 *
 * NUNCA lanza y NUNCA rechaza: devuelve los problemas para que quien llama
 * decida. Al crear se avisa, al editar se rechaza — la misma asimetría que ya
 * gobierna las conductas, resuelta en un solo sitio (`lib/page-engine`).
 */
export function compileCalcRegions(html: string): CompileDocumentResult {
  // Se sale sin tocar nada SÓLO si el documento no menciona NINGUNA pieza del
  // sistema. Salir en cuanto falta `data-ol-calc` era un hueco: un documento con
  // `data-ol-out` y sin contenedor —el modelo olvidando envolver— se iba en
  // silencio, que es justo el fallo que este archivo existe para impedir.
  if (!html.includes(REGION) && !FORMULA_ATTRS.some((f) => html.includes(f.attr))) {
    return { html, regions: 0, compiled: 0, issues: [] };
  }

  let document: HTMLElement;
  try {
    document = parse(html);
  } catch {
    return { html, regions: 0, compiled: 0, issues: [] };
  }

  const regions = document.querySelectorAll(`[${REGION}]`);

  const issues: CalcIssue[] = [];
  let compiled = 0;

  for (const region of regions) {
    // Los nombres viven en la REGIÓN, no en el documento: dos calculadoras en
    // la misma página no se pisan, y cada una se valida contra los suyos.
    const { declared, values } = collectRegionNames(region);
    const env = initialEnv(region);
    // La otra mitad del "nace muerto": un campo que nadie lee.
    for (const huerfano of unreadValues(region)) issues.push(unreadIssue(huerfano));

    // El estado declarado se EVALÚA aquí y el gemelo lleva los valores ya
    // calculados, no programas: son valores INICIALES, no fórmulas vivas. El
    // runtime sólo tiene que hacerles JSON.parse al montar, que es lo más
    // barato que se puede pedir dentro del presupuesto de bytes.
    // Se acepta en la región O en cualquier descendiente, y se consolida en UN
    // gemelo sobre la región. Exigir que viviera en el mismo elemento que
    // `data-ol-calc` sería una regla que el modelo olvidaría, y el castigo
    // sería que el estado se ignora EN SILENCIO: el acumulador nace muerto y
    // todo lo demás sale en verde. Ese fallo ya lo cazamos una vez con el
    // deslizador huérfano; no se repite a propósito.
    const inicial: Record<string, Value> = {};
    let declaraEstado = false;
    for (const el of [region, ...region.querySelectorAll(`[${STATE}]`)]) {
      const rawState = el.getAttribute(STATE);
      if (rawState === undefined || rawState === null) continue;
      declaraEstado = true;
      const st = parseAssignments(rawState);
      if (!st.ok) {
        issues.push({ attr: STATE, formula: rawState, message: st.error.message });
        continue;
      }
      for (const one of st.node) {
        const mal = unknownIn(one.value, declared);
        if (mal) { issues.push({ attr: STATE, formula: rawState, message: mal }); continue; }
        try {
          inicial[one.target] = evaluate(one.value, { ...env, ...inicial }, () => 0);
        } catch {
          inicial[one.target] = 0;
        }
      }
    }
    if (declaraEstado) {
      region.setAttribute(compiledAttr(STATE), programAttr(inicial));
      Object.assign(env, inicial);
    }

    for (const { attr, assign } of FORMULA_ATTRS) {
      for (const el of region.querySelectorAll(`[${attr}]`)) {
        const raw = el.getAttribute(attr) ?? "";
        const checked = checkFormula(raw, assign, declared);
        if (!checked.ok) {
          issues.push({ attr, formula: raw, message: checked.message });
          continue;
        }

        // Una asignación puede ser VARIAS: `c1 = turno; turno = SI(...)`. El
        // gemelo va como lista y el runtime la recorre en orden — sin eso no
        // hay turnos, porque un clic sólo podría hacer una cosa.
        //
        // El destino viaja CON el programa: si no, el runtime tendría que
        // re-parsear la fórmula legible del autor para sacarlo, que es justo
        // lo que compilar en la ingestión existe para no hacer.
        if ("parts" in checked) {
          el.setAttribute(
            compiledAttr(attr),
            programAttr(checked.parts.map((p) => ({ n: p.target, p: compile(p.node) }))),
          );
          compiled += 1;
          continue;
        }

        // `data-ol-out` se compila envuelto en TEXTO(...) y `data-ol-if` con
        // el opcode booleano al final. Así el programa devuelve YA convertido
        // lo que el DOM necesita —una cadena, un booleano— con las MISMAS
        // `t()`/`f()` que usan los dos evaluadores. Sin esto, el cableado del
        // navegador tendría que convertir por su cuenta: una tercera
        // implementación de la coerción, y la tercera es la que se separa.
        const node = attr === OUT ? textOf(checked.node) : checked.node;
        const program: Program = attr === IF ? [...compile(node), "b"] : compile(node);

        el.setAttribute(compiledAttr(attr), programAttr(program));
        compiled += 1;

        // El resultado inicial se escribe DENTRO del elemento, evaluado con lo
        // que el documento ya trae. Así la página nace con un número visible
        // aunque el runtime nunca corra (kill-switch, JS bloqueado, CSP): sin
        // esto la degradación de un cálculo sería un hueco, no una mejora
        // perdida.
        if (attr === OUT && !readsUnset(checked.node, values)) {
          try {
            el.set_content(escapeText(String(evaluate(node, env, () => 0) as Value)));
          } catch {
            /* el contenido que ya tenía se queda: mejor eso que vaciarlo */
          }
        }
      }
    }
  }

  // Una fórmula FUERA de toda región no la compila nadie y nadie se entera.
  //
  // Tampoco es hipotético: en la eval de L3 el modelo puso `data-ol-calc` sobre
  // el BOTÓN del sorteo en vez de sobre un contenedor que envolviera los
  // campos y las salidas. La región existía, el botón estaba dentro de ella, y
  // los `data-ol-out` quedaban fuera — cero fórmulas compiladas y cero issues.
  // Silencio absoluto sobre una página entera que no calculaba nada.
  for (const { attr } of FORMULA_ATTRS) {
    for (const el of document.querySelectorAll(`[${attr}]`)) {
      if (closestRegion(el)) continue;
      issues.push({
        attr,
        formula: el.getAttribute(attr) ?? "",
        message: `está FUERA de todo [${REGION}] — el ${REGION} tiene que ENVOLVER los campos y los resultados, no ir sobre el botón`,
      });
    }
  }

  return { html: document.toString(), regions: regions.length, compiled, issues };
}

/** ¿Vive dentro de una región de cálculo? (ancestro-o-sí-mismo, como
 *  `Element.closest` — el mismo caminado que usa `validate.ts`). */
function closestRegion(el: HTMLElement): boolean {
  for (let cur: HTMLElement | null = el; cur; cur = cur.parentNode) {
    if (cur.getAttribute?.(REGION) !== undefined) return true;
  }
  return false;
}

/** `TEXTO(expr)` — el mismo nodo que escribiría el autor, construido a mano. */
function textOf(node: Node): Node {
  return { kind: "call", fn: "TEXTO", args: [node] };
}

/**
 * El programa, como valor de atributo.
 *
 * `JSON.stringify` no escapa `<` ni `>`, y `setAttribute` sólo escapa comillas,
 * así que un texto literal con marcado dentro salía CRUDO en el atributo:
 * `data-ol-out-c="[&quot;'<img onerror=alert(1)>&quot;]"`. Entre comillas eso
 * es inerte —un navegador no parsea etiquetas dentro de un valor de atributo—
 * pero depende de que nada aguas abajo re-serialice mal, y ese "depende" es
 * justo lo que no queremos sostener. Los escapes `<` siguen siendo JSON
 * válido y `JSON.parse` los devuelve idénticos.
 *
 * El saneador es una capa, no la única.
 */
function programAttr(program: unknown): string {
  return JSON.stringify(program)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

/** El resultado inicial es texto, nunca marcado: sale de una fórmula, no del
 *  autor. */
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
