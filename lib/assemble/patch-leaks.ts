// Parche quirúrgico de fugas de plantilla.
//
// Red de seguridad para lo que el modo clonado (fill-template.ts →
// CLONED_TEMPLATE_ADDENDUM) no alcance a limpiar en la primera pasada. La
// versión anterior de esto re-ejecutaba el relleno ENTERO y se quedaba con el
// resultado completo, lo que arreglaba la fuga pero podía reescribir copy que
// ya estaba bien — el guardián solo miraba el número de fugas, no la calidad
// de lo demás.
//
// Aquí se le manda al modelo SOLO los elementos con fuga, y se aplican SOLO las
// ops cuyo target esté en esa lista. Así la garantía deja de ser una esperanza:
// cualquier elemento no señalado sale byte a byte igual que entró.

import { applyOps, parseOps, stripOpIds, tagWithOpIds } from "@/lib/html-ops";
import type { ExtractedBusinessData } from "../style-match/autofill/types";

/** Elemento etiquetado: id de op + su texto hoja. */
const TAGGED_LEAF =
  /<([a-z][a-z0-9]*)\b[^>]*\bdata-op-id="([^"]+)"[^>]*>([^<]{8,})</gi;

function normalize(s: string): string {
  return s
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface PatchTarget {
  opId: string;
  tag: string;
  text: string;
}

/** Los elementos del documento etiquetado cuyo texto es una fuga conocida. */
export function findLeakTargets(
  taggedHtml: string,
  damaging: Iterable<string>,
): PatchTarget[] {
  const want = new Set([...damaging].map(normalize));
  if (want.size === 0) return [];

  const seen = new Set<string>();
  const out: PatchTarget[] = [];
  let m: RegExpExecArray | null;
  TAGGED_LEAF.lastIndex = 0;
  while ((m = TAGGED_LEAF.exec(taggedHtml)) !== null) {
    const [, tag, opId, raw] = m;
    const text = normalize(raw);
    if (!want.has(text) || seen.has(opId)) continue;
    seen.add(opId);
    out.push({ opId, tag, text: raw.replace(/\s+/g, " ").trim() });
  }
  return out;
}

export function buildPatchPrompt(
  targets: PatchTarget[],
  data: ExtractedBusinessData | Record<string, unknown>,
): string {
  const list = targets
    .map((t) => `  <element id="${t.opId}" tag="${t.tag}">${t.text}</element>`)
    .join("\n");

  return `This page belongs to the business described below. It was cloned from a
template, and the elements listed here STILL CARRY THE PREVIOUS BUSINESS'S COPY.
Rewrite each one for THIS business.

═══ BUSINESS DATA (JSON) ═══
${JSON.stringify(data, null, 2)}

═══ ELEMENTS THAT STILL BELONG TO THE PREVIOUS BUSINESS ═══
${list}

RULES
- Emit one op per element id above. Do not emit ops for any other id.
- Keep the same tag, roughly the same length, and the same language as the
  business data. The design was built for that length.
- Never invent facts you were not given: no prices, addresses, phone numbers,
  emails, testimonials, customer counts, years in business, certifications.
  With no fact to use, write a short truthful line about this business's
  industry instead.
- The previous business's NAME must not appear in your output.
- Never include data-op-id in the HTML you emit.

FORMAT — nothing outside the <edits> block:
<edits>
<edit op="replace" target="${targets[0]?.opId ?? "id"}"><new><${targets[0]?.tag ?? "p"}>new copy here</${targets[0]?.tag ?? "p"}></new></edit>
</edits>

Emit your <edits> block now.`;
}

export interface PatchResult {
  html: string;
  /** Cuántos elementos se señalaron como fuga. */
  targeted: number;
  /** Cuántos se reescribieron de verdad. */
  patched: number;
}

/** Reescribe SOLO los elementos con fuga. Cualquier fallo devuelve el HTML tal
 *  cual entró: esta pasada nunca puede empeorar la página. */
export async function patchTemplateLeaks(
  filledHtml: string,
  damaging: Iterable<string>,
  data: ExtractedBusinessData | Record<string, unknown>,
  callModel: (prompt: string) => Promise<string>,
): Promise<PatchResult> {
  let tagged: string;
  try {
    tagged = tagWithOpIds(filledHtml).taggedHtml;
  } catch {
    return { html: filledHtml, targeted: 0, patched: 0 };
  }

  const targets = findLeakTargets(tagged, damaging);
  if (targets.length === 0) return { html: filledHtml, targeted: 0, patched: 0 };

  let raw: string;
  try {
    raw = await callModel(buildPatchPrompt(targets, data));
  } catch {
    return { html: filledHtml, targeted: targets.length, patched: 0 };
  }

  const allowed = new Set(targets.map((t) => t.opId));
  const { ops } = parseOps(raw);
  // La garantía del parche: fuera de `allowed` no se toca nada, pase lo que
  // pase con lo que devuelva el modelo.
  const scoped = ops.filter((op) => op.type !== "delete" && allowed.has(op.target));
  if (scoped.length === 0) {
    return { html: filledHtml, targeted: targets.length, patched: 0 };
  }

  try {
    const applied = applyOps(tagged, scoped);
    if (!applied.html || applied.appliedCount === 0) {
      return { html: filledHtml, targeted: targets.length, patched: 0 };
    }
    return {
      html: stripOpIds(applied.html),
      targeted: targets.length,
      patched: applied.appliedCount,
    };
  } catch {
    return { html: filledHtml, targeted: targets.length, patched: 0 };
  }
}
