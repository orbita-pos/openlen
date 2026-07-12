import "server-only";

// SOLO SERVIDOR (lo llama lib/agent/tools.ts). Necesita un árbol real, y por
// eso NO puede vivir en el mismo archivo que build.ts, que sí es puro y lo
// importa el preview (client component).
import { parse } from "node-html-parser";
import type { HTMLElement as NHPElement } from "node-html-parser"; // aliased: no pisar el HTMLElement global del DOM

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
  for (let cur: NHPElement | null = el; cur; cur = cur.parentNode) {
    if (cur.getAttribute(m[1]) !== undefined && cur.getAttribute(m[1]) !== null) return true;
  }
  return false;
}

export function validateBehaviors(html: string, reg: Reg = BEHAVIORS): BehaviorIssue[] {
  const dom = parse(html);
  const issues: BehaviorIssue[] = [];

  for (const name of BEHAVIOR_ORDER) {
    const b = reg[name];
    if (!b) continue;
    const roots = dom.querySelectorAll(`[${b.marker}]`);

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
    }
  }
  return issues;
}
