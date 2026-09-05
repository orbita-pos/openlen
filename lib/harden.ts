// Quality S1 post-processor wrapper around the Rust `harden_visual_quality`
// pass exposed by `@openlen/html-engine`. The Rust impl lives at
// crates/html-engine/src/publish/harden.rs.
//
// Surface:
//   const result = hardenVisualQuality(html);
//   if (result.warnings.length > 0) console.warn(...);
//   const finalHtml = result.html;
//
// QUÉ HACE HOY: NO TOCA EL DOCUMENTO. Devuelve el mismo HTML y una lista de
// avisos — frases prohibidas, CTAs genéricas y secciones copiadas casi literal
// del corpus curado. Es una señal para quien mire, no una mano sobre el diseño.
//
// ⚰️ Aquí se describían dos REESCRITURAS —el tope de alfa en los bordes y la
// normalización de `border-white/20` a `/5`— como si siguieran vivas. Se
// retiraron el 2026-08-26 (ver la lápida dentro de `harden_visual_quality` en
// harden.rs): estaban escritas como «arreglar lo que el modelo hace mal», o sea
// corregirle el gusto por debajo y en silencio. Podemos optimizar, no re-decidir.
//
// ⚰️ Y con ellas se fue `HardenCounts`. La impl Rust devolvía `HardenCounts::
// default()` —cuatro ceros— desde aquel día, así que el campo prometía una
// medida que no existe: su único lector sumaba los cuatro y comparaba con 0,
// una rama que no podía entrar nunca. Un contador que sólo sabe decir cero no
// es un dato, es un adorno. Retirado de aquí y del crate el 2026-09-05; el
// `.node` se recompiló, así que `index.d.ts` ya no lo declara.

import { hardenVisualQuality as rustHardenVisualQuality } from "@openlen/html-engine";

export type HardenWarningKind =
  | "banned_phrase"
  | "generic_cta"
  | "copied_section";

function narrowWarningKind(kind: string): HardenWarningKind {
  return kind === "banned_phrase" || kind === "copied_section"
    ? kind
    : "generic_cta";
}

export interface HardenWarning {
  kind: HardenWarningKind;
  matched: string;
}

export interface HardenResult {
  html: string;
  warnings: HardenWarning[];
}

/** Pasa el documento por el escáner de avisos.
 *
 *  El `html` que vuelve es el MISMO que entró — esta pasada ya no reescribe
 *  nada. Idempotente por construcción, no por cuidado.
 */
export function hardenVisualQuality(html: string): HardenResult {
  const r = rustHardenVisualQuality(html);
  return {
    html: r.html,
    warnings: r.warnings.map((w) => ({
      kind: narrowWarningKind(w.kind),
      matched: w.matched,
    })),
  };
}
