import { parse, type HTMLElement } from "node-html-parser";

import { sha256 } from "@/lib/generation/content-hash";
import { composeSectionCandidate } from "@/lib/generation/compose-sections";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";
import { PALETTE_TOKEN } from "@/lib/generation/creative-contracts";
import { fingerprintStructure } from "@/lib/generation/structural-fingerprint";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import { sanitizeForPublish, sealRelease } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { escapeHtml } from "@/lib/marketing/fill";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { SectionRecord } from "@/lib/sections/store";
import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import type { CanonicalSectionRole } from "@/lib/generation/structural-taxonomy";
import { buildDeterministicIntent, buildDeterministicPageCopy } from "./deterministic-page-input";
import { sectionRoleLabel } from "./section-role-labels";
import { finalizeComposedDocument } from "./finalize-composed-document";

const PROMPT_VERSION = "creative-baseline/1.0";
const POLICY_VERSION = "ai-hybrid-policy/1.0";
const LEAF_SELECTOR = "h1,h2,h3,h4,p,li,a,button,span,figcaption,blockquote";

export interface SafeCreativeCandidate {
  readonly html: string;
  readonly title: string;
  readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
  readonly filled: boolean;
  readonly appliedOps: number;
  readonly source: "baseline" | "deepseek" | "deepseek_repair";
}

export type CreativeBaselineResult =
  | { readonly ok: true; readonly candidate: SafeCreativeCandidate; readonly intent: IntentAnalysis; readonly copy: ExtractedBusinessData }
  | {
      readonly ok: false;
      readonly code: "section_inventory_unavailable" | "baseline_invalid";
      /** The composer's own reason, kept for telemetry. The two public codes
       * above collapse a dozen distinct causes into "we could not build it",
       * which is useless when the catalog is the thing that broke. */
      readonly detail: string;
    };

export interface CreativeBaselineDeps {
  readonly composeSection?: typeof composeSectionCandidate;
  readonly finalize?: typeof finalizeComposedDocument;
  readonly sanitize?: typeof sanitizeForPublish;
  readonly seal?: typeof sealRelease;
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
  /** Non-terminal: a guarantee the gate could not give this baseline. The page
   * still ships, so the reason has to reach the journal or it is lost. */
  readonly onDegraded?: (reason: string) => void;
  /** Fragment-body loader for the composer. Injected so the baseline can be
   * built with no network at all. */
  readonly fetchText?: (storageUrl: string) => Promise<string | null>;
}

export interface CreativeBaselineInput {
  readonly projectId: string;
  readonly brief: string;
  readonly profileData: BusinessProfileData;
  readonly records: readonly SectionRecord[];
}

function present(values: readonly (string | null | undefined)[]): string[] {
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4"]);
const ACTION_TAGS = new Set(["a", "button"]);

/**
 * Qué texto le toca a cada hueco. El ELEMENTO decide el largo, el ROL decide el
 * contenido — una sola lista ciclada ponía el brief entero de 240 caracteres
 * dentro de un `<h1>` y repetía "Comenzar · Hotel Valle · Comenzar" por toda la
 * barra de navegación.
 */
function roleCopy(
  role: string,
  copy: ExtractedBusinessData,
  navLabels: readonly string[],
): { heading: string[]; label: string[]; body: string[]; action: string[] } {
  const tagline = copy.tagline_es || copy.tagline_en || copy.business_name;
  const titles = present(copy.features.map((feature) => feature.title));
  const descriptions = present(copy.features.map((feature) => feature.desc));
  const actions = present([copy.cta_primary, copy.cta_secondary]);

  if (role === "header") {
    // Los enlaces de la barra son las secciones que la página SÍ tiene, no la
    // marca repetida: un menú que dice el nombre del negocio cuatro veces no es
    // un menú. El primero es la marca, porque el logotipo de una barra es un
    // enlace y si no se le nombra sale llamándose "Presentación".
    return {
      heading: present([copy.business_name]),
      label: present([copy.business_name]),
      body: [],
      action: present([copy.business_name, ...navLabels, ...actions]),
    };
  }
  if (role === "hero") {
    // El titular es lo que el negocio dice ser en su propia primera frase,
    // acotada; el brief completo baja al párrafo, que es donde cabe.
    return {
      heading: present([copy.industry, copy.business_name]),
      label: present([tagline]),
      body: present([copy.pitch]),
      action: actions,
    };
  }
  if (role === "footer") {
    return { heading: present([copy.business_name]), label: present([tagline]), body: present([tagline]), action: actions };
  }
  return {
    heading: titles.length > 0 ? titles : present([tagline]),
    label: titles.length > 0 ? titles : present([tagline]),
    body: descriptions.length > 0 ? descriptions : present([copy.pitch]),
    action: actions,
  };
}

/** Removes donor text rather than selectively patching it: every visible leaf
 * under a role gets local copy, so no template sentence can survive. */
function fillSectionLocally(
  section: HTMLElement,
  role: string,
  copy: ExtractedBusinessData,
  navLabels: readonly string[],
): number {
  const buckets = roleCopy(role, copy, navLabels);
  const candidates = section.querySelectorAll(LEAF_SELECTOR);
  const leaves = candidates.filter((node) => node.querySelector(LEAF_SELECTOR) === null);
  // `<h1>Una vida <span>X</span> te espera.</h1>`: sólo el span era hoja, así
  // que "Una vida" y "te espera." sobrevivían — la frase del donante partida en
  // dos alrededor de nuestro texto. El hijo con estilo es un hueco; el texto
  // suelto del padre es copia ajena y se va.
  for (const parent of candidates) {
    if (parent.querySelector(LEAF_SELECTOR) === null) continue;
    for (const child of [...parent.childNodes]) {
      if (child.nodeType === 3 && child.rawText.trim().length > 0) parent.removeChild(child);
    }
  }
  const used = { heading: 0, label: 0, body: 0, action: 0 };
  let applied = 0;
  for (const leaf of leaves) {
    const tag = leaf.rawTagName.toLowerCase();
    // Un <span> dentro de un <h1> es el titular, no un párrafo: clasificarlo
    // por su propia etiqueta le metía el brief de 240 caracteres al título.
    // Un <span> suelto es una pastilla o un antetítulo — siempre corto.
    const kind = HEADING_TAGS.has(tag) || (tag === "span" && leaf.closest("h1,h2,h3,h4") !== null)
      ? "heading"
      : ACTION_TAGS.has(tag) ? "action"
      : tag === "span" ? "label"
      : "body";
    // Un cubo vacío cae al que siempre tiene algo antes que dejar pasar el
    // texto del donante: un hueco sin rellenar es una frase de otra empresa.
    const pool = buckets[kind].length > 0 ? buckets[kind] : buckets.body.length > 0 ? buckets.body : buckets.heading;
    if (pool.length === 0) continue;
    const text = pool[used[kind] % pool.length];
    used[kind] += 1;
    if (!text) continue;
    leaf.set_content(escapeHtml(text));
    applied += 1;
  }
  return applied;
}

/** The stable handles the creative sandbox hands to the model. Without them
 * `inspect_canvas` returns an empty outline and every targeted operation fails
 * with `unknown_target`, leaving the model able to change only page CSS. */
function targetId(role: string, ordinal: number): string {
  const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
  return `ol-${slug}-${ordinal}`.slice(0, 64);
}

function fillLocally(html: string, copy: ExtractedBusinessData): { html: string; appliedOps: number } {
  const document = parse(html);
  const sections = document.querySelectorAll("[data-openlen-role]");
  const language = copy.language_detected === "en" ? "en" : "es";
  // El menú se arma con las secciones que la página tiene de verdad, así que se
  // leen todas antes de rellenar ninguna.
  const navLabels = sections
    .map((section) => section.getAttribute("data-openlen-role") ?? "")
    // Una llamada a la acción no es una entrada de menú, y su etiqueta ("Da el
    // paso") se lee como una frase, no como un destino.
    .filter((role) => role && !["header", "footer", "call_to_action", "hero"].includes(role))
    .map((role) => sectionRoleLabel(role as CanonicalSectionRole, language))
    .filter((label): label is string => Boolean(label));

  let appliedOps = 0;
  let ordinal = 0;
  for (const section of sections) {
    const role = section.getAttribute("data-openlen-role") ?? "";
    ordinal += 1;
    section.setAttribute("data-openlen-edit-id", targetId(role, ordinal));
    appliedOps += fillSectionLocally(section, role, copy, navLabels);
  }
  return { html: document.toString(), appliedOps };
}

function withCreativeMarker(html: string, direction: { palette: Record<string, string> }): string {
  const tokens = Object.entries(direction.palette)
    .filter(([name, value]) => name in PALETTE_TOKEN && typeof value === "string" && /^#[0-9a-f]{3,8}$/i.test(value))
    .map(([name, value]) => `${PALETTE_TOKEN[name as keyof typeof PALETTE_TOKEN]}:${value}`)
    .join(";");
  const marker = `<style data-openlen-visual-engine="creative-direction/1.0">:root{${tokens}}</style>`;
  const document = parse(html);
  const head = document.querySelector("head");
  if (!head) return html.replace("<body", `${marker}<body`);
  head.insertAdjacentHTML("beforeend", marker);
  return document.toString();
}

const INVENTORY_CODES = new Set([
  "section_inventory_stale", "section_fragment_unavailable", "section_fragment_stale",
  "section_fragment_invalid", "no_eligible_sections", "section_role_coverage_failed",
]);

export async function buildCreativeBaseline(
  input: CreativeBaselineInput,
  deps: CreativeBaselineDeps = {},
): Promise<CreativeBaselineResult> {
  const intent = buildDeterministicIntent(input.brief);
  const copy = buildDeterministicPageCopy(input.brief, intent);
  if (input.records.length === 0) return { ok: false, code: "section_inventory_unavailable", detail: "no_published_sections" };

  // Provider-free by construction: the two paid seams are replaced rather than
  // gated. `beforeCreative` is NOT the switch — returning false there makes the
  // composer abort with internal_error instead of skipping paid work.
  let appliedOps = 0;
  const composed = await (deps.composeSection ?? composeSectionCandidate)({
    route: "section_composition",
    projectId: input.projectId,
    intent,
    intentHash: sha256(JSON.stringify(intent)),
    records: input.records,
    copy,
    brand: { accent: input.profileData?.brand?.accent ?? null },
  }, {
    ...(deps.fetchText ? { fetchText: deps.fetchText } : {}),
    fillAssembled: (async (html: string) => {
      const local = fillLocally(html, copy);
      appliedOps = local.appliedOps;
      return { html: local.html, filled: true, appliedOps: local.appliedOps, leaksBefore: 0, leaksAfter: 0, durationMs: 0 };
    }) as never,
    adaptTemplateSkeleton: (async (adaptInput: { html: string }) => {
      const direction = buildDeterministicCreativeDirection(intent).direction;
      // The delivery gate requires exactly one creative-direction marker, and
      // the page may as well carry the direction's tokens while it is there.
      const themed = withCreativeMarker(adaptInput.html, direction);
      const fingerprint = fingerprintStructure(themed);
      return {
        ok: true as const,
        status: "adapted" as const,
        html: themed,
        creativeDirectionVersion: "creative-direction/1.0" as const,
        planVersion: "skeleton-adaptation-plan/1.0" as const,
        creativeDirection: direction,
        promptVersion: PROMPT_VERSION,
        modelId: "deterministic",
        structuralFingerprintBefore: fingerprint,
        structuralFingerprintAfter: fingerprint,
        usage: { creative: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 }, critic: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 } },
        durationMs: 0,
      };
    }) as never,
  });
  if (!composed.ok) {
    return { ok: false, code: INVENTORY_CODES.has(composed.reasonCode) ? "section_inventory_unavailable" : "baseline_invalid", detail: composed.reasonCode };
  }

  const title = present([copy.business_name, copy.hero_keyword])[0]
    ?? (intent.language === "es" ? "Nuevo Proyecto" : "New Project");
  const finalized = (deps.finalize ?? finalizeComposedDocument)({
    html: composed.html,
    profileData: input.profileData,
    title,
  });
  if (!finalized.ok) return { ok: false, code: "baseline_invalid", detail: "finalize_failed" };
  const seal = deps.seal ?? sealRelease;
  // The gate, not a bare seal: the baseline was the one document a creative
  // session could deliver without ever meeting normalizeBornCanonical,
  // ensurePageMeta or validateBehaviors — true whenever the model edited
  // nothing. Render stays out; the baseline runs its own check below.
  const passed = await passHtmlGate(finalized.html, { sanitize: deps.sanitize ?? sanitizeForPublish, seal }, { render: false, seal: true, behaviors: "block" });
  let delivered: string;
  let degradedReason: string | null = null;
  if (passed.ok) {
    delivered = passed.html;
  } else if (passed.code === "behaviors_invalid") {
    // Fail open, and only here. An edit has a previous good state to fall back
    // to; the baseline has none, so refusing it costs the user the page
    // instead of a guarantee. Everything below is a safety refusal — the
    // reserved marker above all — and those never open.
    degradedReason = passed.detail ? `behaviors_${passed.detail}` : "behaviors_invalid";
    const fallback = seal(finalized.html);
    if (!fallback.sealed) return { ok: false, code: "baseline_invalid", detail: "seal_failed" };
    delivered = fallback.html;
  } else {
    return { ok: false, code: "baseline_invalid", detail: passed.detail ?? passed.code };
  }
  const rendered = await (deps.render ?? (async () => ({ mobileOverflow: false, invalidGeometry: false })))(delivered);
  // Weak typography is an improvement signal for the sandbox, not a safety abort.
  if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) return { ok: false, code: "baseline_invalid", detail: rendered ? "baseline_render_defect" : "baseline_render_failed" };

  // Only now: the degradation is non-terminal by contract, so reporting it
  // before the seal and the render agree would put "degraded, delivered" in
  // the journal next to the failure of a request that delivered nothing.
  if (degradedReason) deps.onDegraded?.(degradedReason);

  return {
    ok: true,
    intent,
    copy,
    candidate: {
      html: delivered,
      title,
      filled: appliedOps > 0,
      appliedOps,
      source: "baseline",
      visualEngine: {
        schemaVersion: "visual-engine-project/1.0",
        route: "section_composition",
        templateId: null,
        creativeDirection: composed.creativeDirection,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        contractVersion: "creative-direction/1.0",
        // The manifest hash must track the bytes we actually deliver: the
        // delivery gate compares it against sha256 of the final document.
        compositionManifest: { ...composed.manifest, outputHash: sha256(delivered) },
      },
    },
  };
}
