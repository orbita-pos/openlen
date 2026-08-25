import "server-only";

import { createHash } from "node:crypto";

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
  const closest = closestAttrElement(el, attr);
  return closest?.getAttribute(attr) ?? null;
}

function closestAttrElement(el: NHPElement, attr: string): NHPElement | null {
  for (let cur: NHPElement | null = el; cur; cur = cur.parentNode) {
    if (cur.getAttribute(attr) !== undefined) return cur;
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

/** Proyección canónica de la configuración conductual del documento: UNA fila
 * por elemento tocado por alguna receta, más una fila por relación cruzada.
 *
 * IDENTIDAD ESTRUCTURAL, no de configuración. Cada fila se ancla en un camino
 * `tag[i]/tag[j]` construido sólo con etiquetas y posición. La versión anterior
 * volcaba todo a un multiconjunto global ordenado, y por eso DOS CONTROLES QUE
 * SE INTERCAMBIAN LO QUE HACEN se cancelaban entre sí: `#ba` copiaba «a» y `#bb`
 * copiaba «b», se cruzaban, y la huella salía idéntica. El agente cerraba el
 * turno con la prueba vieja sobre una página que ya hacía otra cosa.
 *
 * EL PRECIO, aceptado a propósito: mover un control a otra posición del árbol
 * ahora SÍ cambia la huella, y antes no. No es evitable: un intercambio de
 * configuración entre dos hermanos y una reordenación de esos dos hermanos
 * producen EXACTAMENTE el mismo árbol. Como uno cambia la conducta y el otro
 * no, y son indistinguibles, se avisa de los dos. El coste de avisar de más es
 * pedir una prueba que sobraba; el de callarse es publicar una conducta que
 * nadie miró.
 *
 * VALOR EFECTIVO, no serialización de atributos. `effective` pregunta qué lee
 * el runtime, no qué pone en el HTML: añadir `multiple` a un `<select>` cambia
 * su `value` sin tocar un solo atributo de las opciones, y cambiar el TEXTO de
 * un `<option value="pro">` no cambia nada de lo que el runtime consume.
 *
 * COSTE LINEAL. Cada elemento aparece UNA vez por muchas recetas que lo
 * toquen, y los objetivos de una relación cruzada se indexan por valor en vez
 * de recorrerse por cada raíz. La versión anterior repetía targets y partes
 * dentro de cada raíz: 500 filtros + 500 items daban 19 MB de huella y 600 ms,
 * y `tocaConducta` calcula DOS huellas por edición. Para medir eso ANTES del
 * hash está `behaviorContractProjectionStats`: el digest siempre son 64
 * caracteres, así que su longitud no prueba nada sobre el coste.
 *
 * Lo que sigue sin participar: texto suelto, orden de atributos y `data-op-id`.
 */
function projectBehaviorContract(html: string, reg: Reg = BEHAVIORS) {
  const dom = parse(html);
  const selectorAttrs = (selector: string) =>
    [...selector.matchAll(/\[([a-z0-9-]+)/gi)].map((match) => match[1]!);

  type ElementProjection = {
    el: NHPElement;
    path: string;
    roles: Set<string>;
    attrs: Map<string, string | null>;
    missing: Set<string>;
    text?: string;
    effective?: unknown;
  };
  const elements = new Map<NHPElement, ElementProjection>();
  const pathCache = new Map<NHPElement, string>();
  const siblingIndexes = new Map<NHPElement, Map<NHPElement, number>>();

  const elementChildren = (parent: NHPElement): NHPElement[] =>
    parent.childNodes.filter((node): node is NHPElement => Boolean((node as NHPElement).tagName));
  const siblingIndex = (el: NHPElement): number => {
    const parent = el.parentNode as NHPElement | null;
    if (!parent) return 0;
    let indexes = siblingIndexes.get(parent);
    if (!indexes) {
      indexes = new Map();
      const counts = new Map<string, number>();
      for (const child of elementChildren(parent)) {
        const tag = child.tagName.toLowerCase();
        const index = counts.get(tag) ?? 0;
        indexes.set(child, index);
        counts.set(tag, index + 1);
      }
      siblingIndexes.set(parent, indexes);
    }
    return indexes.get(el) ?? 0;
  };
  const pathOf = (el: NHPElement): string => {
    const cached = pathCache.get(el);
    if (cached) return cached;
    const tag = el.tagName.toLowerCase();
    const own = `${tag}[${siblingIndex(el)}]`;
    const parent = el.parentNode as NHPElement | null;
    const path = parent?.tagName ? `${pathOf(parent)}/${own}` : own;
    pathCache.set(el, path);
    return path;
  };
  const projected = (el: NHPElement): ElementProjection => {
    let out = elements.get(el);
    if (!out) {
      out = { el, path: pathOf(el), roles: new Set(), attrs: new Map(), missing: new Set() };
      // El `id` PROPIO del elemento no entra a propósito. Ningún runtime lo
      // lee: la única forma en que un id participa de una conducta es siendo
      // el ancla de un `idRef`, y ese caso se proyecta explícitamente más
      // abajo (rol `:idRef`, más un `missing` cuando el ancla desaparece).
      // MEDIDO: quitándolo, 291/291 en lib/behaviors y 141/141 en tools —
      // no sujetaba ni una. Lo que sí hacía era pedir una prueba cada vez
      // que el modelo renombraba un id decorativo.
      elements.set(el, out);
    }
    return out;
  };

  const optionValue = (option: NHPElement): string => {
    const explicit = option.getAttribute("value");
    return explicit !== undefined ? explicit : option.textContent.trim();
  };
  const formControlValue = (el: NHPElement): unknown => {
    const tag = el.tagName.toLowerCase();
    if (tag === "textarea") return ["textarea", el.textContent];
    if (tag === "select") {
      const options = el.querySelectorAll("option");
      const multiple = el.getAttribute("multiple") !== undefined;
      const selected = options.filter((option) => option.getAttribute("selected") !== undefined);
      const effective = (selected[0] ?? (!multiple ? options[0] : undefined));
      return ["select", multiple, effective ? optionValue(effective) : ""];
    }
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return ["input", type, el.getAttribute("checked") !== undefined];
      if (type === "radio") {
        return ["input", type, el.getAttribute("checked") !== undefined, el.getAttribute("value") ?? "on"];
      }
      return ["input", type, el.getAttribute("value") ?? ""];
    }
    return [tag, el.textContent.trim()];
  };
  const mark = (
    el: NHPElement,
    role: string,
    attrs: readonly string[] = [],
    text = false,
    effective?: "formControlValue" | "optionValue",
  ) => {
    const out = projected(el);
    out.roles.add(role);
    for (const attr of attrs) out.attrs.set(attr, el.getAttribute(attr) ?? null);
    if (text) out.text = el.textContent.trim();
    if (effective === "formControlValue") out.effective = formControlValue(el);
    if (effective === "optionValue") {
      out.effective = [
        "option",
        el.getAttribute("selected") !== undefined,
        optionValue(el),
      ];
    }
  };

  const queryCache = new Map<NHPElement, Map<string, NHPElement[]>>();
  const query = (root: NHPElement, selector: string): NHPElement[] => {
    let bySelector = queryCache.get(root);
    if (!bySelector) {
      bySelector = new Map();
      queryCache.set(root, bySelector);
    }
    let found = bySelector.get(selector);
    if (!found) {
      found = root.querySelectorAll(selector);
      bySelector.set(selector, found);
    }
    return found;
  };

  const relations = new Map<string, unknown>();
  for (const name of BEHAVIOR_ORDER) {
    const behavior = reg[name];
    if (!behavior) continue;
    const schema = behavior.schema;
    const targetIndexes = new Map<string, Map<string, NHPElement[]>>();
    for (const ref of schema.crossRefs ?? []) {
      const index = new Map<string, NHPElement[]>();
      for (const target of dom.querySelectorAll(`[${ref.target}]`)) {
        const value = target.getAttribute(ref.target) ?? "";
        const bucket = index.get(value) ?? [];
        bucket.push(target);
        index.set(value, bucket);
      }
      targetIndexes.set(ref.target, index);
    }

    for (const root of dom.querySelectorAll(`[${behavior.marker}]`)) {
      const rootAttrs = [
        ...(schema.root.kind === "flag" ? [] : [behavior.marker]),
        ...(schema.requiredAttrs ?? []),
        ...(schema.untrusted ?? []),
        ...(schema.fingerprint?.rootAttrs ?? []),
      ];
      mark(root, `${name}:root`, rootAttrs);

      // Un `idRef` cablea la conducta a OTRO elemento por su id, y ese
      // elemento no lleva marcador, así que sin esto no entraba en la
      // proyección: renombrar `<code id="a">` deja el botón apuntando al
      // vacío y la huella salía IDÉNTICA. Se proyecta su EXISTENCIA y su
      // sitio, nunca su texto — un cupón que cambia de valor sigue siendo el
      // mismo contrato, y hay una prueba que lo sujeta.
      if (schema.root.kind === "idRef") {
        const ref = (root.getAttribute(behavior.marker) ?? "").trim();
        const ancla = ref ? dom.querySelector(`#${CSS_ESCAPE(ref)}`) : null;
        if (ancla) mark(ancla, `${name}:idRef`);
        else projected(root).missing.add(`${name}:idRef:${ref}`);
      }

      let structuralRoot = root;
      if (schema.requiresHost) {
        const hostAttr = selectorAttrs(schema.requiresHost)[0];
        const host = hostAttr ? closestAttrElement(root, hostAttr) : null;
        if (host) {
          mark(host, `${name}:host`);
          structuralRoot = host;
        } else {
          projected(root).missing.add(`${name}:host:${schema.requiresHost}`);
        }
      }

      for (const part of schema.parts ?? []) {
        const matches = query(structuralRoot, part.selector);
        if (!matches.length) projected(root).missing.add(`${name}:part:${part.selector}`);
        for (const match of matches) mark(match, `${name}:part:${part.selector}`, part.contractAttrs);
      }

      for (const ref of schema.crossRefs ?? []) {
        const viaEl = closestAttrElement(root, ref.via);
        const viaValue = viaEl?.getAttribute(ref.via) ?? null;
        if (viaEl) mark(viaEl, `${name}:via`, [ref.via]);
        const targets = viaValue === null ? [] : (targetIndexes.get(ref.target)?.get(viaValue) ?? []);
        const hostPath = viaEl ? pathOf(viaEl) : pathOf(root);
        const relationKey = JSON.stringify([name, hostPath, ref.via, viaValue, ref.target]);
        if (!relations.has(relationKey)) {
          const targetPaths: string[] = [];
          for (const target of targets) {
            mark(target, `${name}:target`, [ref.target]);
            targetPaths.push(pathOf(target));
            for (const part of ref.targetParts ?? []) {
              const matches = query(target, part.selector);
              if (!matches.length) projected(target).missing.add(`${name}:target-part:${part.selector}`);
              for (const match of matches) {
                mark(match, `${name}:target-part:${part.selector}`, part.attrs, part.text, part.effective);
              }
            }
          }
          relations.set(relationKey, [name, hostPath, [ref.via, viaValue], ref.target, targetPaths.sort()]);
        }
      }

      if (schema.exprAttrs) {
        const attrs = [schema.exprAttrs.namesFrom, ...schema.exprAttrs.formulas.map((formula) => formula.attr)];
        for (const attr of attrs) {
          const matches = query(root, `[${attr}]`);
          if (!matches.length) projected(root).missing.add(`${name}:expr:${attr}`);
          for (const match of matches) mark(match, `${name}:expr:${attr}`, [attr]);
        }
      }

      for (const part of schema.fingerprint?.descendants ?? []) {
        const matches = query(root, part.selector);
        if (!matches.length) projected(root).missing.add(`${name}:config:${part.selector}`);
        for (const match of matches) {
          mark(match, `${name}:config:${part.selector}`, part.attrs, part.text, part.effective);
        }
      }
    }
  }

  const elementRows = [...elements.values()].map((entry) => [
    entry.path,
    [...entry.roles].sort(),
    [...entry.attrs.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [...entry.missing].sort(),
    entry.text ?? null,
    entry.effective ?? null,
  ]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const relationRows = [...relations.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const serialized = JSON.stringify([elementRows, relationRows]);
  return { serialized, elementCount: elementRows.length, relationCount: relationRows.length };
}

export function behaviorContractProjectionStats(html: string, reg: Reg = BEHAVIORS) {
  const projection = projectBehaviorContract(html, reg);
  return {
    bytes: Buffer.byteLength(projection.serialized, "utf8"),
    elementCount: projection.elementCount,
    relationCount: projection.relationCount,
  };
}

export function behaviorContractFingerprint(html: string, reg: Reg = BEHAVIORS): string {
  const projection = projectBehaviorContract(html, reg);
  return createHash("sha256").update(projection.serialized).digest("hex");
}

export function validateBehaviors(html: string, reg: Reg = BEHAVIORS): BehaviorIssue[] {
  const dom = parse(html);
  const issues: BehaviorIssue[] = [];
  // crossRefs se deduplica por (receta, target, valor): un grupo con N
  // botones es UN cableado roto, no N — un issue por botón sería ruido que
  // entierra al resto del aviso. El separador es `\u0000` ESCRITO COMO
  // ESCAPE, nunca como byte crudo: un NUL literal en el fuente hace que
  // ripgrep declare BINARIO el fichero entero y lo salte en silencio, así
  // que cualquier búsqueda futura pasaría de largo por este archivo.
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
        const key = `${b.name}\u0000${ref.target}\u0000${val}`;
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
