import "server-only";

// SOLO SERVIDOR (lo llama lib/agent/tools.ts). Necesita un árbol real, y por
// eso NO puede vivir en el mismo archivo que build.ts, que sí es puro y lo
// importa el preview (client component).
import { parse } from "node-html-parser";
import type { HTMLElement as NHPElement } from "node-html-parser"; // aliased: no pisar el HTMLElement global del DOM

import { checkFormula, collectRegionNames, unreadIssue, unreadValues } from "@/lib/expr/document";

import { BEHAVIORS, BEHAVIOR_ORDER } from "./registry";
import type { AttrSpec, Behavior, BehaviorIssue, BehaviorName } from "./types";

type Reg = Partial<Record<BehaviorName, Behavior>>;

// Un control mal cableado (un filtro que apunta a una rejilla inexistente) es
// otra vez un boton muerto. Se caza en AUTORIA, no en runtime: estos issues
// viajan por el canal `aviso` (lib/agent/tools.ts) y el modelo los arregla en
// el mismo turno.
//
// NB: este archivo NO tiene un if/else por receta. Interpreta el `schema`.
// Anadir la conducta #20 no lo toca.

function checkValue(spec: AttrSpec, raw: string): string | null {
  switch (spec.kind) {
    case "flag":
      return null;
    case "isoDate":
      return Number.isNaN(Date.parse(raw))
        ? `el valor "${raw}" no es una fecha ISO válida (usa 2026-08-15T20:00-06:00, no texto libre)`
        : null;
    case "ms": {
      const n = Number(raw);
      if (!Number.isInteger(n)) return `el valor "${raw}" debe ser un entero de milisegundos`;
      return n < spec.min ? `${n}ms es demasiado corto (mínimo ${spec.min}ms)` : null;
    }
    case "tagList":
      return raw.trim() === "" ? `la lista de etiquetas está vacía` : null;
    case "httpUrl":
      return /^https?:\/\//i.test(raw.trim()) ? null : `la URL "${raw}" debe empezar por http:// o https://`;
    case "idRef":
      return raw.trim() === "" ? `falta el id al que apunta` : null;
  }
}

/** Escapa un id para meterlo en un selector `#id`. `CSS.escape` no existe en
 *  Node, y un id con un punto o dos puntos rompería el selector en silencio. */
function CSS_ESCAPE(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

/** node-html-parser expone `matches`, pero solo con selectores simples. Nuestros
 *  `requiresHost` son siempre de la forma `[data-ol-x]`, así que lo resolvemos
 *  leyendo el atributo: es exacto y no depende del motor de selectores.
 *
 *  Camina ancestro-o-sí-mismo (como `Element.closest`) porque `requiresHost`
 *  cubre DOS formas según la receta: el atributo COEXISTE en el MISMO
 *  elemento (autoplay ⇒ `<div data-ol-row data-ol-autoplay>`, ver
 *  validate.test.ts) o vive en un ANCESTRO (filter ⇒ el botón
 *  `[data-ol-filter]` dentro de `<div data-ol-filter-group>`, ver
 *  recipes/filter.ts). Un elemento es el primer paso de su propia caminata,
 *  así que el caso mismo-elemento sigue funcionando sin rama aparte. */
function matchesHost(el: NHPElement, host: string): boolean {
  const m = /^\[([a-z0-9-]+)\]$/i.exec(host.trim());
  if (!m) throw new Error(`requiresHost debe ser de la forma [data-ol-x], no "${host}"`);
  return closestAttrValue(el, m[1]) !== null;
}

/** Valor del atributo en el elemento o su ancestro más cercano que lo lleve
 *  (ancestro-o-sí-mismo, como `Element.closest`), o null si nadie lo tiene.
 *  Compartido por `requiresHost` y `crossRefs` — un solo caminado, una sola
 *  semántica. */
function closestAttrValue(el: NHPElement, attr: string): string | null {
  for (let cur: NHPElement | null = el; cur; cur = cur.parentNode) {
    const v = cur.getAttribute(attr);
    if (v !== undefined && v !== null) return v;
  }
  return null;
}

/** Une los `issue.message` en UNA línea, o `undefined` si no hay nada que
 *  decir. Única fuente de este "join" — lib/agent/tools.ts (canal `aviso` del
 *  agente) y app/api/templates/ai-design/route.ts (Chat, Arreglo 2 de la
 *  revisión final) lo comparten en vez de cada uno concatenar los mensajes a
 *  su manera; cada caller sigue envolviendo el resultado con SU PROPIA frase
 *  (el agente dice "arréglalas con editar_pagina", ai-design no tiene esa
 *  herramienta), así que solo el "qué issues hay" se comparte, no el "qué
 *  hacer con ellos". */
export function describeBehaviorIssues(issues: BehaviorIssue[]): string | undefined {
  return issues.length ? issues.map((i) => i.message).join(" · ") : undefined;
}

export function validateBehaviors(html: string, reg: Reg = BEHAVIORS): BehaviorIssue[] {
  const dom = parse(html);
  const issues: BehaviorIssue[] = [];
  // crossRefs se deduplica por (receta, target, valor): un grupo con N
  // botones es UN cableado roto, no N — un issue por botón sería ruido que
  // entierra al resto del aviso.
  const crossRefSeen = new Set<string>();

  for (const name of BEHAVIOR_ORDER) {
    const b = reg[name];
    if (!b) continue;
    const roots = dom.querySelectorAll(`[${b.marker}]`);

    // requiresCss — ver el comentario del campo en types.ts. Se comprueba
    // UNA vez por receta (no por root: es una propiedad del documento) y
    // solo cuando la conducta de verdad se usa. Contra el HTML crudo, no el
    // árbol: el patrón debe poder ver dentro de <style> y de los class="".
    if (roots.length > 0 && b.schema.requiresCss) {
      const { pattern, why } = b.schema.requiresCss;
      if (!new RegExp(pattern, "i").test(html)) {
        issues.push({
          behavior: b.name,
          message: `${b.marker}: ${why} — el control nacería muerto`,
        });
      }
    }

    for (const root of roots) {
      const raw = root.getAttribute(b.marker) ?? "";

      const valueErr = checkValue(b.schema.root, raw);
      if (valueErr) issues.push({ behavior: b.name, message: `${b.marker}: ${valueErr}` });

      if (
        b.schema.root.kind === "idRef" &&
        raw.trim() !== "" &&
        dom.querySelector(`#${CSS_ESCAPE(raw.trim())}`) === null
      ) {
        issues.push({
          behavior: b.name,
          message: `${b.marker}="${raw}" apunta a un id que no existe en la página — el control nacería muerto`,
        });
      }

      if (b.schema.requiresHost && !matchesHost(root, b.schema.requiresHost)) {
        issues.push({
          behavior: b.name,
          message: `${b.marker} debe ir sobre un elemento ${b.schema.requiresHost} — ahí no hace nada`,
        });
      }

      for (const part of b.schema.parts ?? []) {
        if (root.querySelectorAll(part.selector).length < part.min) {
          issues.push({
            behavior: b.name,
            message: `${b.marker}: falta ${part.selector} — ${part.why}`,
          });
        }
      }

      for (const attr of b.schema.requiredAttrs ?? []) {
        if (root.getAttribute(attr) === undefined) {
          issues.push({
            behavior: b.name,
            message: `${b.marker}: falta el atributo ${attr} — sin él el control nacería muerto`,
          });
        }
      }

      for (const attr of b.schema.untrusted ?? []) {
        const v = root.getAttribute(attr);
        if (v !== undefined && v !== null) {
          const err = checkValue({ kind: "httpUrl" }, v);
          if (err) issues.push({ behavior: b.name, message: `${b.marker}: ${err}` });
        }
      }

      // Ver el comentario de `crossRefs` en types.ts. Si `via` no aparece en
      // la caminata, requiresHost ya reportó la falta del host — callarse
      // aquí evita dos issues por el mismo hueco. La comparación es contra
      // getAttribute EXACTO (nunca un selector construido con el valor
      // interpolado): un valor con comillas o corchetes rompería el selector,
      // y el propio runtime de filter ya paga ese mismo cuidado con su
      // try/catch alrededor de querySelector.
      // exprAttrs — ver el comentario del campo en types.ts. Los nombres se
      // recogen UNA vez por raíz (son de la REGIÓN, no del documento: dos
      // calculadoras en la misma página no se pisan) y cada fórmula se parsea
      // contra ellos. El parseo y la definición de "declarado" viven en
      // lib/expr/document.ts, que es el mismo código que compila en la
      // ingestión — aquí no hay una segunda copia que pueda separarse.
      if (b.schema.exprAttrs) {
        const { namesFrom, formulas } = b.schema.exprAttrs;
        const { declared } = collectRegionNames(
          root,
          namesFrom,
          formulas.filter((f) => f.assign).map((f) => f.attr),
        );
        // Un campo que ninguna fórmula lee es un control muerto — la mitad
        // simétrica de "una fórmula que lee un campo inexistente".
        for (const huerfano of unreadValues(root, namesFrom, formulas)) {
          const issue = unreadIssue(huerfano);
          issues.push({ behavior: b.name, message: `${issue.attr}="${issue.formula}": ${issue.message}` });
        }
        for (const f of formulas) {
          for (const el of root.querySelectorAll(`[${f.attr}]`)) {
            const raw = el.getAttribute(f.attr) ?? "";
            const checked = checkFormula(raw, !!f.assign, declared);
            if (!checked.ok) {
              issues.push({
                behavior: b.name,
                message: `${f.attr}="${raw}": ${checked.message}`,
              });
            }
          }
        }
      }

      for (const ref of b.schema.crossRefs ?? []) {
        const val = closestAttrValue(root, ref.via);
        if (val === null) continue;
        const key = `${b.name} ${ref.target} ${val}`;
        if (crossRefSeen.has(key)) continue;
        crossRefSeen.add(key);
        const found = dom
          .querySelectorAll(`[${ref.target}]`)
          .some((el) => el.getAttribute(ref.target) === val);
        if (!found) {
          issues.push({
            behavior: b.name,
            message: `${b.marker}: [${ref.via}="${val}"] no tiene su pareja [${ref.target}="${val}"] en la página — ${ref.why}`,
          });
        }
      }
    }
  }
  return issues;
}
