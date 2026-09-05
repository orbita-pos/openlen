import { normalizeBornCanonical } from "@/lib/normalize";
import { validateBehaviors } from "@/lib/conductas-heredadas/validate";
import type { BehaviorIssue } from "@/lib/conductas-heredadas/types";
import { ensurePageMeta, type EnsurePageMetaOptions } from "@/lib/publish/ensure-page-meta";

const RESERVED_MARKER = "data-slot-path=";

export type HtmlGateRefusal =
  | "reserved_marker"
  | "sanitization_failed"
  | "behaviors_invalid"
  | "seal_failed"
  | "render_failed";

export interface HtmlGateDeps {
  readonly sanitize: (html: string) => { html: string | null; errors: string[]; removed: { scripts: number; eventHandlers: number; dangerousUrls: number; iframes: number; metaRefresh: number } };
  readonly seal?: (html: string) => { html: string; sealed: boolean };
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
  /**
   * Runs on the normalized document, before ensurePageMeta.
   *
   * NO ES UNA PUERTA TRASERA DE PROPÓSITO GENERAL: corre DESPUÉS de `sanitize`,
   * así que lo que inyecte llega sin sanear y sólo se vuelve a mirar por el
   * marcador reservado. Quien meta algo aquí responde de su propia seguridad.
   *
   * ⚰️ Este comentario explicaba, con nombres y ficheros, por qué eso era
   * seguro para `seedBrandIntoHtml` — que escapaba cada cadena del usuario,
   * validaba el acento como hex estricto y rechazaba `javascript:`/`data:`
   * antes de un href. Los cinco ficheros que nombraba murieron con el perfil de
   * negocio el 2026-08-31, y una garantía argumentada sobre código que ya no
   * existe es peor que ninguna: se lee como si siguiera vigente.
   *
   * HOY el único `beforeMeta` vivo es el de `lib/page-engine/prepare.ts`, y lo
   * que pasa por él no es texto del usuario: son reparaciones deterministas
   * sobre el documento ya saneado (un solo `<h1>`, `scroll-padding-top`,
   * colores atados a tokens, los cálculos compilados). Ninguna interpola una
   * cadena de fuera.
   *
   * LA REGLA, que sobrevive a los dos: si un `beforeMeta` futuro recibe salida
   * del modelo o texto del usuario sin escapar, necesita su propio saneado.
   * Esta costura no se lo da.
   */
  readonly beforeMeta?: (html: string) => string;
}

export interface HtmlGatePolicy {
  readonly render: boolean;
  readonly seal: boolean;
  readonly behaviors: "block" | "warn";
  /** ¿Se le aplica la cadena born-canonical al documento?
   *
   * TRUE para HTML AJENO —el que pega el usuario, una plantilla, el
   * autofill—: ahí normalizar es lo correcto, porque el documento viene de
   * fuera y los controles de Tema tienen que poder conducirlo.
   *
   * FALSE para lo que escribe el MODELO. Decisión de Jesús (2026-09-04):
   * el modelo decide sus colores. La cadena le reescribía «radius, spacing,
   * type scale, display font, accent, background + text color» y su paleta
   * sobre nuestros tokens — era la última etapa que decidía por él, y la
   * más profunda: las otras le cambiaban una foto o un color ilegible;
   * ésta, el sistema de diseño entero.
   *
   * Es la MISMA línea que ya separa `sanitize`: `sanitizeForPublish` para lo
   * ajeno, `gateReservedMarker` para el modelo. No es una palanca que se
   * pueda encender: es de qué procedencia es el documento.
   *
   * LO QUE CUESTA: una página que no nace con los tokens no responde al
   * selector de Tema del inspector. Se acepta a cambio de que la página sea
   * la que el modelo escribió. */
  readonly normalize?: boolean;
  /** Forwarded to ensurePageMeta as-is. Omit for today's no-options call. */
  readonly meta?: EnsurePageMetaOptions;
}

export type HtmlGateResult =
  | {
      readonly ok: true;
      readonly html: string;
      readonly removed: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
      readonly warnings: string[];
      /**
       * Present only when behaviours were WARNED about (policy "warn" found
       * issues and kept the document). `warnings` is one bounded slug by
       * design; this is the detail behind it, for a caller that has to record
       * what was wrong and how many. Symmetric with the refusal branch — if
       * the gate saw issues it hands them back either way, so nobody has to
       * re-run validateBehaviors to recover them.
       */
      readonly issues?: readonly BehaviorIssue[];
    }
  | {
      readonly ok: false;
      readonly code: HtmlGateRefusal;
      readonly detail?: string;
      /**
       * Only on `behaviors_invalid`. `detail` is the bounded machine slug;
       * this is what a human-facing sentence is built from, via
       * `describeBehaviorIssues`. It exists because the surfaces that put
       * that prose in front of the model cannot recompute it once the gate
       * owns the decision — the canonical bytes it validated are not
       * returned on a refusal, and re-running normalize+meta caller-side to
       * get them back is the drift this gate deletes. The gate still does
       * not phrase anything; it hands back what it saw.
       */
      readonly issues?: readonly BehaviorIssue[];
      /**
       * Present on every refusal raised AFTER sanitization succeeded. What
       * sanitize removed is true regardless of which later stage said no, and
       * a caller that only hears the blocking reason will send the model back
       * with the same deleted <script> attached.
       */
      readonly removed?: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number };
    };

/**
 * One place a document becomes safe to keep, so a guarantee added once
 * protects every surface that adopts it. Order is part of the contract: the
 * reserved marker is refused before any pass that could rewrite it out of
 * sight.
 *
 * ⚰️ ESTE COMENTARIO MINTIÓ POR TERCERA VEZ, y se corrigió el 2026-09-05.
 * Decía «ADOPTED — six callers», listaba NUEVE, y dos de ellos
 * —`lib/curate/creative-sandbox.ts` y `lib/curate/creative-baseline.ts`— eran
 * ficheros borrados: `lib/curate/` no existe. Nombraba también a
 * `lib/agent/tools.ts persistHtmlChange`, `app/api/templates/ai-design` y
 * `app/api/generate` como llamadores DIRECTOS, y no lo son: los tres entran por
 * el motor de página. El propio comentario avisaba de que esto volvería a
 * pasar. Volvió. Cuenta con `grep -n "passHtmlGate(" $(git ls-files '*.ts')`,
 * no de memoria, y no vuelvas a escribir aquí un número que no salga de ahí.
 *
 * ADOPTADO — CINCO llamadas directas en CUATRO ficheros, más el motor:
 *   - `app/api/projects/[id]/apply-template`  { render: false, seal: false, behaviors: "block" }
 *   - `app/api/templates/autofill`            { render: false, seal: false, behaviors: "block" }
 *   - `app/api/projects/from-html`            { render: false, seal: false, behaviors: "warn"  }
 *   - `app/api/projects/from-template`        { render: false, seal: false, behaviors: "warn"  }
 *     (dos veces — una para la portada, otra por cada subpágina clonada)
 *   - `lib/page-engine/prepare.ts` — EL MOTOR. Por aquí entran las TRES
 *     superficies del modelo (Crear, el Chat y Len) y ninguna otra, así que
 *     `/api/generate`, `/api/templates/ai-design` y `/api/agent` llegan a esta
 *     puerta a través de él, no por su cuenta. Y llega distinto: `sanitize` es
 *     `gateReservedMarker` en vez de `sanitizeForPublish`, `normalize: false`,
 *     y `behaviors` sale de una condición —"block" sólo en modo edición y sin
 *     `priorHtml`; "warn" en cuanto hay un documento anterior con el que
 *     comparar, para que un defecto HEREDADO no condene la edición de hoy.
 *
 * Todas pasan `seal: false`: nada se sirve desde una ruta que escribe en la
 * base, y `publishToDir` sella al publicar. `render: false` en todas, porque
 * una petición interactiva no puede pagar el arranque de un navegador.
 *
 * `behaviors` is the fail-closed/fail-open split, and it is not a taste
 * setting. "block" where the user already HAS a page and refusing costs them
 * only the edit. "warn" where the project does not exist yet and refusing
 * would cost them the whole page — those record what was lost via
 * `collectDegradations` into `data.degradations[]` and the workspace tells
 * the user. If you add a "warn" caller without writing that record, you have
 * built a silent failure.
 *
 * NO ADOPTADO:
 *   - `publishToDir` — fuera de alcance a propósito, no pendiente. Sanea y
 *     sella por página dentro de su propio bucle de horneado.
 *
 * ⚰️ Aquí figuraban `assemble` y `finalizeComposedDocument` como «pendientes a
 * propósito, no olvidados». No están pendientes: la tubería de composición se
 * borró, `lib/assemble/` no existe y `finalizeComposedDocument` no aparece en
 * ningún fichero salvo esta línea. Un pendiente sobre código inexistente se lee
 * como trabajo por hacer y manda a alguien a buscarlo.
 *
 * If your path IS on the adopted list, do not re-run sanitize/normalize/meta
 * yourself — duplicating them is how the two chains drift apart. If it is
 * NOT, you still own your own sanitization; adoption is not implied by this
 * file existing.
 */
export async function passHtmlGate(
  html: string,
  deps: HtmlGateDeps,
  policy: HtmlGatePolicy,
): Promise<HtmlGateResult> {
  if (html.includes(RESERVED_MARKER)) return { ok: false, code: "reserved_marker" };

  const sanitized = deps.sanitize(html);
  if (sanitized.html === null) return { ok: false, code: "sanitization_failed" };
  // Every refusal from here down carries this: sanitize already ran, and what
  // it removed stays true no matter which later stage says no.
  const removed = {
    scripts: sanitized.removed.scripts,
    eventHandlers: sanitized.removed.eventHandlers,
    iframes: sanitized.removed.iframes,
    dangerousUrls: sanitized.removed.dangerousUrls,
  };

  // ⚰️ NORMALIZACIÓN BORN-CANONICAL RETIRADA (Jesús, 2026-09-04).
  //
  // Aquí corría `normalizeBornCanonical` sobre TODO lo que pasa por la
  // puerta — o sea las tres superficies del modelo. Su cadena reescribía
  // «radius, spacing, type scale, display font, accent, background + text
  // color» y la paleta del modelo sobre nuestros tokens de CSS.
  //
  // Era la última etapa que decidía por el modelo, y la más profunda: las
  // otras le cambiaban las fotos o un color ilegible; ésta le reescribía el
  // sistema de diseño entero. La decisión es que el modelo decide sus
  // colores, y esta cadena era exactamente lo contrario.
  //
  // LO QUE ESTO CUESTA, dicho aquí para que nadie lo redescubra: el selector
  // de Tema del inspector conduce esos tokens. Una página que no nace con
  // ellos no responde a esos controles. Se acepta a cambio de que la página
  // sea la que el modelo escribió.
  const normalized =
    policy.normalize === false ? sanitized.html : normalizeBornCanonical(sanitized.html);
  const seeded = deps.beforeMeta ? deps.beforeMeta(normalized) : normalized;
  // beforeMeta runs after the one marker check above, on bytes deps.sanitize
  // never saw — the guarantee that never bends has to be re-proven here too.
  if (seeded.includes(RESERVED_MARKER)) return { ok: false, code: "reserved_marker", removed };
  const canonical = ensurePageMeta(seeded, policy.meta);

  const behaviorIssues = validateBehaviors(canonical);
  const warnings: string[] = [];
  let warnedIssues: readonly BehaviorIssue[] | undefined;
  if (behaviorIssues.length > 0) {
    if (policy.behaviors === "block") {
      return { ok: false, code: "behaviors_invalid", detail: behaviorSlug(behaviorIssues), issues: behaviorIssues, removed };
    }
    warnings.push(behaviorSlug(behaviorIssues));
    warnedIssues = behaviorIssues;
  }

  let output = canonical;
  if (policy.seal) {
    if (!deps.seal) return { ok: false, code: "seal_failed", detail: "sealer_unavailable", removed };
    const sealed = deps.seal(canonical);
    if (!sealed.sealed) return { ok: false, code: "seal_failed", removed };
    output = sealed.html;
  }

  if (policy.render) {
    if (!deps.render) return { ok: false, code: "render_failed", detail: "renderer_unavailable", removed };
    const rendered = await deps.render(output);
    if (!rendered) return { ok: false, code: "render_failed", detail: "render_unavailable", removed };
    if (rendered.mobileOverflow) return { ok: false, code: "render_failed", detail: "mobile_overflow", removed };
    if (rendered.invalidGeometry) return { ok: false, code: "render_failed", detail: "invalid_geometry", removed };
  }

  return { ok: true, html: output, removed, warnings, issues: warnedIssues };
}

/** Keeps the reason bounded by construction: a slug or nothing. The prose
 *  from describeBehaviorIssues (lib/conductas-heredadas/validate.ts) is for a user,
 *  not for a refusal code — `BehaviorIssue.behavior` is already a
 *  lowercase `BehaviorName` slug ("countdown", "lightbox", …), so the regex
 *  fallback below only fires if that type ever stops being a plain slug. */
function behaviorSlug(issues: BehaviorIssue[]): string {
  const raw = typeof issues[0]?.behavior === "string" ? issues[0].behavior : "";
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return /^[a-z][a-z0-9_]{0,39}$/.test(slug) ? slug : "behavior_issue";
}
