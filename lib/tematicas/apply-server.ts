// Server-side counterpart of the iframe inspect-script's applyTematica
// (components/workspace-v2/use-element-inspect.ts:951, wired from
// app/[locale]/new/page.tsx:2150's applyTematica callback) — the same write
// (a tagged <style data-ol-tematica>, the kit's font <link>, the
// data-ol-tematica[-bg] attrs on <html>, plus the kit's token bundle + mode
// via the theme-bundle channel) as a pure string→string transform, so an
// agent tool can stamp a temática onto project.data.html without a browser.
// Strip-then-stamp shape mirrors scripts/tematicas-dress.ts (the authoring
// CLI that pre-dresses showcase templates).
//
// KNOWN DELTA (F2): the iframe's contrast "re-ink" pass (olReinkForWorld,
// use-element-inspect.ts:763+) measures every text-bearing element's LIVE
// computed color against the new world's grounds and re-inks whatever fails
// contrast — that needs a real DOM + getComputedStyle, not a string
// transform. The kit CSS here is var-driven and covers most cases on its
// own; if a result still needs a touch-up, the model can chain
// editar_pagina.

import { applyThemeTokensToHtml } from "@/lib/agent/theme-apply";
import { getTematica, resolveBackdrop, tematicaCss, TEMATICA_PRESETS } from "@/lib/tematicas/presets";

const HTML_OPEN_TAG_RE = /<html\b[^>]*>/i;
const HEAD_CLOSE_RE = /<\/head>/i;

/** Strip a prior stamp: the tagged <style>, the tagged font <link>, and the
 *  data-ol-tematica[-bg] attrs off <html>. Deliberately leaves the kit's
 *  --ol-* tokens (and data-ol-mode) in place — those are generic theme
 *  state that rides the same channel as the Looks engine, and the user may
 *  have hand-adjusted them after applying the kit. Removing the *world*
 *  shouldn't silently revert unrelated theme edits. */
export function removeTematicaFromHtml(html: string): string {
  // The style regex must tolerate attribute serialization: this module emits
  // the bare `<style data-ol-tematica>`, but the editor iframe's
  // setAttribute('data-ol-tematica','') saves as `<style data-ol-tematica="">`
  // — both shapes reach project.data.html.
  return html
    .replace(/<style[^>]*\bdata-ol-tematica\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<link[^>]*\bdata-ol-tematica\b[^>]*>/gi, "")
    .replace(/\s+data-ol-tematica(?:-bg)?="[^"]*"/gi, "");
}

/** Insert `inject` right before the FIRST `</head>`, or synthesize a `<head>`
 *  right after `<html …>` when the doc has none. Both branches use a
 *  FUNCTION replacer (never a plain string) — a string replacement pattern
 *  interprets `$&`/`$\``/`$'`/`$1` sequences, and kit CSS (or any caller-
 *  supplied `inject`) is arbitrary content that must land byte-literal. */
export function injectBeforeHeadClose(html: string, inject: string): string {
  return HEAD_CLOSE_RE.test(html)
    ? html.replace(HEAD_CLOSE_RE, () => `${inject}</head>`)
    : html.replace(HTML_OPEN_TAG_RE, (tag) => `${tag}<head>${inject}</head>`);
}

/** Install a kit's full-page world. Replace-not-stack: any prior stamp is
 *  removed first, so re-applying a different kit (or the same one with a
 *  different backdrop) never leaves duplicate <style>/<link> tags behind. */
export function applyTematicaToHtml(
  html: string,
  tematicaId: string,
  backdropId?: string,
): { html: string } | { error: string } {
  const kit = getTematica(tematicaId);
  // El texto del rechazo ES prompt: llega al modelo como resultado de la
  // herramienta. Uno escueto («temática desconocida») dejaba al Agente
  // contestarle al usuario que SÍ le había aplicado la temática navideña que
  // acababa de pedirle — medido en los evals. Se le dice qué existe, qué puede
  // hacer en su lugar, y qué no puede afirmar.
  if (!kit) {
    return {
      error: `no existe la temática «${tematicaId}». El catálogo entero es: ${TEMATICA_PRESETS.map((k) => k.id).join(", ")}. `
        + "Puedes conseguir ese ambiente por otra vía —cambiar_tema para la paleta, editar_texto para el copy y editar_html para la decoración— "
        + `pero NO le digas al usuario que aplicaste la temática «${tematicaId}»: no existe y no la aplicaste. `
        + "Dile con qué la conseguiste, o que esa temática no está en el catálogo.",
    };
  }

  let out = removeTematicaFromHtml(html);

  // Resolve the variant ONCE and stamp the resolved scene id — an unknown
  // backdropId falls back to the kit's hero scene (resolveBackdrop's own
  // rule), so the attr always matches what the kit CSS actually paints
  // (never a raw unvalidated string that would drift the editor's picker).
  const resolvedBg = backdropId ? resolveBackdrop(kit, backdropId).id : undefined;

  out = out.replace(HTML_OPEN_TAG_RE, (tag) => {
    const bgAttr = resolvedBg ? ` data-ol-tematica-bg="${resolvedBg}"` : "";
    return tag.replace(/^<html\b/i, (open) => `${open} data-ol-tematica="${kit.id}"${bgAttr}`);
  });

  const css = tematicaCss(kit, resolvedBg);
  const fontLink = kit.fontHref
    ? `<link rel="stylesheet" data-ol-tematica href="${kit.fontHref}">`
    : "";
  const inject = `${fontLink}<style data-ol-tematica>${css}</style>`;
  out = injectBeforeHeadClose(out, inject);

  // The kit's token bundle rides the same channel cambiar_tema uses, plus
  // its ink direction as the data-ol-mode attr — mirrors the client's
  // separate applyThemeBundle(kit.tokens) + applyThemeMode(kit.mode) calls
  // (app/[locale]/new/page.tsx:2169-2171) collapsed into one write.
  out = applyThemeTokensToHtml(out, {
    ...kit.tokens,
    "data-ol-mode": kit.mode === "dark" ? "dark" : "",
  });

  return { html: out };
}
