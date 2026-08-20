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

import { compile } from "./compile";
import { evaluate } from "./evaluate";
import { parseAssignment, parseExpression, referencedNames } from "./parse";
import type { Value } from "./types";

export const REGION = "data-ol-calc";
export const VALUE = "data-ol-val";
export const OUT = "data-ol-out";
export const IF = "data-ol-if";
export const WHEN = "data-ol-when";
export const SET = "data-ol-set";
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

/**
 * Compila todas las regiones del documento.
 *
 * NUNCA lanza y NUNCA rechaza: devuelve los problemas para que quien llama
 * decida. Al crear se avisa, al editar se rechaza — la misma asimetría que ya
 * gobierna las conductas, resuelta en un solo sitio (`lib/page-engine`).
 */
export function compileCalcRegions(html: string): CompileDocumentResult {
  if (!html.includes(REGION)) return { html, regions: 0, compiled: 0, issues: [] };

  let document: HTMLElement;
  try {
    document = parse(html);
  } catch {
    return { html, regions: 0, compiled: 0, issues: [] };
  }

  const regions = document.querySelectorAll(`[${REGION}]`);
  if (regions.length === 0) return { html, regions: 0, compiled: 0, issues: [] };

  const issues: CalcIssue[] = [];
  let compiled = 0;

  for (const region of regions) {
    // Los nombres viven en la REGIÓN, no en el documento: dos calculadoras en
    // la misma página no se pisan, y cada una se valida contra los suyos.
    const declared = new Set<string>();
    for (const el of region.querySelectorAll(`[${VALUE}]`)) {
      const name = el.getAttribute(VALUE)?.trim();
      if (name) declared.add(name);
    }
    // Un `data-ol-set` declara su destino: la ruleta escribe `elegido`, que
    // ningún campo del visitante produce.
    for (const el of region.querySelectorAll(`[${SET}]`)) {
      const a = parseAssignment(el.getAttribute(SET) ?? "");
      if (a.ok) declared.add(a.node.target);
    }

    for (const [attr, isAssignment] of [[OUT, false], [IF, false], [SET, true]] as const) {
      for (const el of region.querySelectorAll(`[${attr}]`)) {
        const raw = el.getAttribute(attr) ?? "";
        let node;
        if (isAssignment) {
          const a = parseAssignment(raw);
          if (!a.ok) { issues.push({ attr, formula: raw, message: a.error.message }); continue; }
          node = a.node.value;
        } else {
          const e = parseExpression(raw);
          if (!e.ok) { issues.push({ attr, formula: raw, message: e.error.message }); continue; }
          node = e.node;
        }

        // Un nombre que nadie produce es una fórmula que nace muerta: se
        // detecta AQUÍ, mientras todavía se puede decir, y no en la página del
        // visitante donde ya sólo se ve un cero.
        const desconocidos = [...referencedNames(node)].filter((n) => !declared.has(n));
        if (desconocidos.length > 0) {
          issues.push({
            attr,
            formula: raw,
            message: `usa ${desconocidos.map((n) => `"${n}"`).join(", ")}, que no existe en esta región — declara un campo con ${VALUE}="${desconocidos[0]}"`,
          });
          continue;
        }

        el.setAttribute(compiledAttr(attr), programAttr(compile(node)));
        compiled += 1;

        // El resultado inicial se escribe DENTRO del elemento, evaluado con
        // todo vacío. Así la página nace con un número visible aunque el
        // runtime nunca corra (kill-switch, JS bloqueado, CSP): sin esto la
        // degradación de un cálculo sería un hueco, no una mejora perdida.
        if (attr === OUT) {
          try {
            el.set_content(escapeText(String(evaluate(node, {}, () => 0) as Value)));
          } catch {
            /* el contenido que ya tenía se queda: mejor eso que vaciarlo */
          }
        }
      }
    }
  }

  return { html: document.toString(), regions: regions.length, compiled, issues };
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
