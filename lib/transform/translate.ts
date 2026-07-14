import "server-only";

// Mitad B del transform (spec 2026-07-14): TRANSLATE por lista blanca
// CERRADA. Cada mapper exige el patrón COMPLETO medido en el catálogo (los
// fixtures reales viven en scratch/transform-fixtures/); si falta una pieza,
// no traduce — mejor un botón muerto conocido que una reescritura rota.
//
// Tras cada mapper que ESCRIBE marcadores se corre validateBehaviors: si esa
// receta reporta issues, la mutación entera de ESE mapper se descarta (los
// demás sobreviven). Los mappers estructurales (menú móvil label+checkbox)
// quedaron FUERA de la v1 a propósito: reescribir estructura por heurística
// es la clase de juicio que el spec prohíbe automatizar — tabs y menú se
// inventarían y su degradación se hace honesta, nada más.
import { parse, type HTMLElement as NHPElement } from "node-html-parser";
import { validateBehaviors } from "@/lib/behaviors/validate";

export interface TranslateResult {
  html: string;
  translated: string[];
  tabsFound: number;
}

function hasClassToken(el: NHPElement, token: string): boolean {
  return (el.getAttribute("class") ?? "").split(/\s+/).includes(token);
}

function removeClassToken(el: NHPElement, token: string): void {
  const kept = (el.getAttribute("class") ?? "").split(/\s+/).filter((c) => c && c !== token);
  if (kept.length) el.setAttribute("class", kept.join(" "));
  else el.removeAttribute("class");
}

/** heron-shape: <button data-copy="npm install heron"> junto al <code> que
 *  muestra EXACTAMENTE ese texto. La conducta copy lee del DOM por id
 *  (data-ol-copy="<id>"), así que el mapper localiza el vecino de texto
 *  idéntico (subiendo hasta 3 ancestros) y le asigna id si no tiene. Sin
 *  coincidencia exacta → no se traduce. */
function copyMapper(html: string): { html: string; applied: boolean } {
  const dom = parse(html);
  const buttons = dom
    .querySelectorAll("button[data-copy]")
    .filter((b) => b.getAttribute("data-ol-copy") === undefined);
  if (buttons.length === 0) return { html, applied: false };

  let applied = false;
  let seq = 0;
  const freeId = () => {
    let id = `ol-copy-${seq++}`;
    while (dom.querySelector(`#${id}`)) id = `ol-copy-${seq++}`;
    return id;
  };

  for (const btn of buttons) {
    const wanted = (btn.getAttribute("data-copy") ?? "").trim();
    if (!wanted) continue;
    let target: NHPElement | null = null;
    let scope: NHPElement | null = btn.parentNode;
    for (let depth = 0; depth < 3 && scope && !target; depth++, scope = scope.parentNode) {
      for (const cand of scope.querySelectorAll("code,pre,kbd,samp")) {
        if (cand === btn || btn.querySelectorAll("*").includes(cand)) continue;
        if (cand.text.trim() === wanted) {
          target = cand;
          break;
        }
      }
    }
    if (!target) continue;
    let id = target.getAttribute("id");
    if (!id) {
      id = freeId();
      target.setAttribute("id", id);
    }
    btn.setAttribute("data-ol-copy", id);
    if (btn.getAttribute("data-ol-copied") === undefined) btn.setAttribute("data-ol-copied", "¡Copiado!");
    btn.removeAttribute("data-copy");
    applied = true;
  }
  return applied ? { html: dom.toString(), applied } : { html, applied: false };
}

/** salon-shape: botones hermanos [data-tag] (incluye "all") + un contenedor
 *  cuyos hijos llevan data-tag. Exige que CADA tag de botón (menos all)
 *  exista en los items — si falta uno, el grupo entero se salta. */
function filterMapper(html: string): { html: string; applied: boolean } {
  const dom = parse(html);
  let applied = false;
  let seq = 0;

  const groups = new Map<NHPElement, NHPElement[]>();
  for (const btn of dom.querySelectorAll("button[data-tag]")) {
    const p = btn.parentNode;
    if (!p || p.getAttribute("data-ol-filter-group") !== undefined) continue;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p)!.push(btn);
  }

  const candidates = dom.querySelectorAll("*").filter((el) => {
    if (el.getAttribute("data-ol-filter-target") !== undefined) return false;
    const kids = el.childNodes.filter((n): n is NHPElement => n instanceof Object && "getAttribute" in n);
    const tagged = kids.filter(
      (k) => k.getAttribute?.("data-tag") !== undefined && k.rawTagName?.toLowerCase() !== "button",
    );
    return tagged.length >= 2;
  });

  for (const [parent, buttons] of groups) {
    if (buttons.length < 2) continue;
    const btnTags = buttons
      .map((b) => (b.getAttribute("data-tag") ?? "").trim())
      .filter((t) => t && t !== "all");
    if (btnTags.length === 0) continue;

    const target = candidates.find((el) => {
      if (el === parent) return false;
      const itemTags = new Set<string>();
      for (const k of el.childNodes as unknown as NHPElement[]) {
        const v = k.getAttribute?.("data-tag");
        if (v) v.split(/\s+/).forEach((t) => t && itemTags.add(t));
      }
      return btnTags.every((t) => itemTags.has(t));
    });
    if (!target) continue;

    const name = target.getAttribute("id") ?? `ol-filter-${seq++}`;
    parent.setAttribute("data-ol-filter-group", name);
    target.setAttribute("data-ol-filter-target", name);
    const anyActive = buttons.some((b) => hasClassToken(b, "active"));
    for (const b of buttons) {
      const tag = (b.getAttribute("data-tag") ?? "").trim();
      b.setAttribute("data-ol-filter", tag === "all" ? "*" : tag);
      const pressed = anyActive ? hasClassToken(b, "active") : tag === "all";
      b.setAttribute("aria-pressed", pressed ? "true" : "false");
    }
    for (const k of target.childNodes as unknown as NHPElement[]) {
      const v = k.getAttribute?.("data-tag");
      if (v && k.getAttribute("data-ol-tag") === undefined) k.setAttribute("data-ol-tag", v);
    }
    applied = true;
  }
  return applied ? { html: dom.toString(), applied } : { html, applied: false };
}

/** choir-shape: botones [data-tab] + paneles id="tab-<val>" (o panel-<val>)
 *  ocultos con la clase `hidden`. SIN conducta que marcar (tabs es la #8
 *  pendiente): aquí solo degradación honesta — si TODOS los paneles nacen
 *  ocultos, se destapa el primero — e inventario para la telemetría. */
function tabsHonesty(html: string): { html: string; tabsFound: number } {
  const dom = parse(html);
  const buttons = dom.querySelectorAll("button[data-tab]");
  if (buttons.length === 0) return { html, tabsFound: 0 };

  const panels: NHPElement[] = [];
  for (const b of buttons) {
    const v = b.getAttribute("data-tab");
    if (!v) continue;
    const p = dom.querySelector(`#tab-${v}`) ?? dom.querySelector(`#panel-${v}`);
    if (p) panels.push(p);
  }
  const allHidden =
    panels.length > 0 && panels.every((p) => hasClassToken(p, "hidden") || p.hasAttribute("hidden"));
  if (!allHidden) return { html, tabsFound: buttons.length };

  removeClassToken(panels[0], "hidden");
  panels[0].removeAttribute("hidden");
  return { html: dom.toString(), tabsFound: buttons.length };
}

/** Corre un mapper y valida SU receta: issues nuevos de esa conducta →
 *  descartar la mutación entera de este mapper (nunca guardar un cableado
 *  que el propio validador declara muerto). */
function applyValidated(
  html: string,
  behavior: "copy" | "filter",
  mapper: (h: string) => { html: string; applied: boolean },
): { html: string; applied: boolean } {
  const out = mapper(html);
  if (!out.applied) return { html, applied: false };
  const issues = validateBehaviors(out.html).filter((i) => i.behavior === behavior);
  if (issues.length > 0) return { html, applied: false };
  return out;
}

export function translateKnownPatterns(html: string): TranslateResult {
  const translated: string[] = [];
  let out = html;

  const copy = applyValidated(out, "copy", copyMapper);
  if (copy.applied) {
    out = copy.html;
    translated.push("copy");
  }

  const filter = applyValidated(out, "filter", filterMapper);
  if (filter.applied) {
    out = filter.html;
    translated.push("filter");
  }

  const tabs = tabsHonesty(out);
  out = tabs.html;

  return { html: out, translated, tabsFound: tabs.tabsFound };
}
