import { normalizeBornCanonical } from "@/lib/normalize";
import { ensurePageMeta, type EnsurePageMetaOptions } from "@/lib/publish/ensure-page-meta";

const RESERVED_MARKER = "data-slot-path=";

export type HtmlGateRefusal =
  | "reserved_marker"
  | "sanitization_failed"
  | "seal_failed"
  | "render_failed";

export interface HtmlGateDeps {
  readonly sanitize: (html: string) => { html: string | null; errors: string[]; removed: { scripts: number; eventHandlers: number; dangerousUrls: number; iframes: number; metaRefresh: number } };
  readonly seal?: (html: string) => { html: string; sealed: boolean };
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
  // ⚰️ Aquí iba `beforeMeta`, una costura para inyectar algo tras sanear y
  // antes de los metadatos. Su último usuario fue la calculadora de
  // `data-ol-calc` en lib/page-engine/prepare.ts, retirada el 2026-10-04 con las
  // conductas; antes, la siembra del perfil de negocio (2026-08-31).
}

export interface HtmlGatePolicy {
  readonly render: boolean;
  readonly seal: boolean;
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
    }
  | {
      readonly ok: false;
      readonly code: HtmlGateRefusal;
      readonly detail?: string;
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
 *   - `app/api/projects/[id]/apply-template`  { render: false, seal: false }
 *   - `app/api/templates/autofill`            { render: false, seal: false }
 *   - `app/api/projects/from-html`            { render: false, seal: false }
 *   - `app/api/projects/from-template`        { render: false, seal: false }
 *     (dos veces — una para la portada, otra por cada subpágina clonada)
 *   - `lib/page-engine/prepare.ts` — EL MOTOR. Por aquí entran las superficies
 *     del modelo (el Chat y Len; Crear también, hasta que se retiró el
 *     2026-10-06) y ninguna otra, así que `/api/templates/ai-design` y
 *     `/api/agent` llegan a esta puerta a través de él, no por su cuenta. Y
 *     llega distinto: `sanitize` es `gateReservedMarker` en vez de
 *     `sanitizeForPublish` y `normalize: false`.
 *
 * Todas pasan `seal: false`: nada se sirve desde una ruta que escribe en la
 * base, y `publishToDir` sella al publicar. `render: false` en todas, porque
 * una petición interactiva no puede pagar el arranque de un navegador.
 *
 * ⚰️ Aquí se explicaba `behaviors` («block»/«warn»), la puerta de las
 * conductas `data-ol-*`, retiradas el 2026-10-04 (ver la nota del cuerpo).
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
  const canonical = ensurePageMeta(normalized, policy.meta);

  // ⚰️ LAS CONDUCTAS (`data-ol-*`) SE RETIRARON el 2026-10-04, a petición de
  // Jesús. Su motor no se inyectaba desde el 2026-08-26 (al publicar) y el
  // 2026-08-31 (en el lienzo), así que la puerta validaba marcadores de algo que
  // no corría, y con `behaviors: "block"` podía RECHAZAR una edición por ellos.
  // En producción no los llevaba ningún proyecto (medido ese día). Se fueron con
  // ellas el motor, sus recetas, `lib/expr` (la calculadora de `data-ol-calc`),
  // el carrusel y la mitad «traductora» del transformador de plantillas.

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

  return { ok: true, html: output, removed };
}

