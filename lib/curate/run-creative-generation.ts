import type { BusinessProfileData } from "@/lib/business-profiles/types";
import type { IntentAnalysis } from "@/lib/generation/contracts";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { SectionRecord } from "@/lib/sections/store";
import { sealAiCompositionDirection, sealAiCompositionOutput, type validateAiCompositionDelivery } from "./ai-composition-delivery";
import type { buildCreativeBaseline, SafeCreativeCandidate } from "./creative-baseline";
import type { AdvisoryReviewResult } from "./advisory-visual-review";
import type { CreativeSessionResult } from "./deepseek-creative-session";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import { adoptModelPalette } from "./adopt-model-palette";
import { applyCreativeDirection } from "./apply-creative-direction";
import { contractReasonCode, measureContract } from "@/lib/contract/measure";
import { insertModulePlaceholders, modulesFromBrief } from "./module-placeholders";
import { DEFAULT_PAGE_EFFORT, effortProfile, type PageEffort } from "./page-effort";
import { isolateModelTokens } from "./isolate-model-tokens";
import { repairInvertedSurfaces } from "./repair-inverted-surfaces";
import { repairUnreadableText } from "./repair-unreadable-text";
import type { UnreadableTextFinding } from "@/lib/ai/visual-quality-renderer";

export interface CreativeGenerationInput {
  readonly projectId: string;
  readonly brief: string;
  readonly profileData: BusinessProfileData;
  readonly records: readonly SectionRecord[];
  /** Cuánto trabajo compró el usuario. Sólo mueve turnos y rondas: el tope de
   *  dinero por página no depende de esto. */
  readonly effort?: PageEffort;
  readonly onStage?: (stage: string) => void;
}

export interface CreativeGenerationDeps {
  readonly buildBaseline: typeof buildCreativeBaseline;
  /** Forwarded to the baseline builder so the whole path can run offline. */
  readonly fetchText?: (storageUrl: string) => Promise<string | null>;
  /** The baseline's own render gate. Without it the baseline builder falls back
   * to a stub that approves every document, so overflow ships unchecked. */
  readonly renderCandidate?: (html: string) => Promise<{
    mobileOverflow: boolean;
    invalidGeometry: boolean;
    unreadableText?: readonly UnreadableTextFinding[];
  } | null>;
  /** Quién elige cómo se ve la página, leyendo el brief. Sin esto la elige el
   * vecino más parecido entre 7 nichos —así una clínica dental salió con la
   * paleta de terror—. Se le pregunta una sola vez, y sólo después de que la
   * baseline segura exista. */
  readonly chooseDirection?: (brief: string, intent: IntentAnalysis) => Promise<CreativeDirection | null>;
  /** `intent` travels with both improvement stages: the image boundary and the
   * vision critic both speak the taxonomy, not the free-text brief. */
  readonly runCreativeSession: (input: {
    requestId: string;
    brief: string;
    baseline: SafeCreativeCandidate;
    intent: IntentAnalysis;
    maxTurns: number;
    maxAcceptedMutations: number;
  }) => Promise<CreativeSessionResult>;
  readonly runAdvisoryReview: (input: {
    requestId: string;
    brief: string;
    candidate: SafeCreativeCandidate;
    intent: IntentAnalysis;
    effort: PageEffort;
  }) => Promise<AdvisoryReviewResult>;
  readonly validateDelivery: typeof validateAiCompositionDelivery;
  /** Terminal: only the two branches that cost the user a page use it. */
  readonly recordFailure?: (stage: string, reasonCode: string) => void;
  /** Non-terminal: a stage that failed while the page still ships. */
  readonly recordDegraded?: (stage: string, reasonCode: string) => void;
}

export type CreativeGenerationResult =
  | {
      readonly ok: true;
      readonly route: "section_composition";
      readonly templateId: null;
      readonly title: string;
      readonly html: string;
      readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
      readonly filled: boolean;
      readonly appliedOps: number;
      /** True when the delivered page is the baseline because an improvement
       * stage failed or was refused. Never a reason to abort. */
      readonly degraded: boolean;
    }
  | { readonly ok: false; readonly stage: "composition" | "delivery_gate"; readonly reasonCode: string };

/** La dirección es gusto, no corrección: cualquier fallo —incluido un
 *  transporte que lanza— deja la determinista y la página sigue. */
async function elect(
  brief: string,
  intent: IntentAnalysis,
  choose: CreativeGenerationDeps["chooseDirection"],
): Promise<CreativeDirection | null> {
  if (!choose) return null;
  try {
    return await choose(brief, intent);
  } catch {
    return null;
  }
}

function notify(input: CreativeGenerationInput, stage: string): void {
  try { input.onStage?.(stage); } catch {
    // Progress reporting cannot change delivery.
  }
}

/**
 * Baseline first, then improvement. Once a safe baseline exists the only ways
 * out are a delivered page or a delivery gate that refuses both the improved
 * candidate and the baseline. No provider can abort a page from here.
 */
export async function runCreativeGeneration(
  input: CreativeGenerationInput,
  deps: CreativeGenerationDeps,
): Promise<CreativeGenerationResult> {
  const effort = input.effort ?? DEFAULT_PAGE_EFFORT;
  const profile = effortProfile(effort);
  notify(input, "baseline");
  let baseline;
  try {
    baseline = await deps.buildBaseline({
      projectId: input.projectId,
      brief: input.brief,
      profileData: input.profileData,
      records: input.records,
    }, {
      ...(deps.fetchText ? { fetchText: deps.fetchText } : {}),
      ...(deps.renderCandidate ? { render: deps.renderCandidate } : {}),
      ...(deps.chooseDirection ? { chooseDirection: deps.chooseDirection } : {}),
      // The baseline ships even when the gate cannot give it every guarantee,
      // so the reason only exists if it is recorded here.
      onDegraded: (reason: string) => deps.recordDegraded?.("baseline", reason),
    });
  } catch {
    deps.recordFailure?.("baseline", "composition_failed");
    return { ok: false, stage: "composition", reasonCode: "composition_failed" };
  }
  if (!baseline.ok) {
    // The user-facing reason stays coarse; the journal gets the real cause, or
    // "the catalog broke" is indistinguishable from "the page did".
    deps.recordFailure?.("baseline", baseline.detail || baseline.code);
    return { ok: false, stage: "composition", reasonCode: baseline.code };
  }

  let lastKnownGood = baseline.candidate;
  let degraded = false;

  // La dirección se elige AQUÍ y no antes, y el orden no es un detalle: nada se
  // paga hasta que existe una baseline segura, así que un brief que el catálogo
  // no puede cubrir no cuesta ni una llamada. Lo que se repinta es sólo el
  // color —la baseline ya midió su render con estas cajas— y el modelo recibe
  // la dirección completa, porque su página sí se vuelve a renderizar.
  const elected = await elect(input.brief, baseline.intent, deps.chooseDirection);
  if (elected) {
    const repainted = applyCreativeDirection(lastKnownGood.html, elected);
    try {
      lastKnownGood = {
        ...lastKnownGood,
        html: repainted,
        visualEngine: sealAiCompositionDirection(
          lastKnownGood.visualEngine,
          repainted,
          elected,
        ) as SafeCreativeCandidate["visualEngine"],
      };
    } catch {
      // Repintar es gusto. Un manifiesto que no se puede resellar cuesta el
      // color, jamás la página: la puerta de entrega compara sha256(html) y
      // devolvería la baseline entera por un tono.
      deps.recordDegraded?.("baseline", "direction_unsealable");
    }
  } else if (deps.chooseDirection) {
    deps.recordDegraded?.("baseline", "direction_unavailable");
  }

  notify(input, "creative");
  try {
    const creative = await deps.runCreativeSession({
      requestId: input.projectId,
      brief: input.brief,
      baseline: lastKnownGood,
      intent: baseline.intent,
      maxTurns: profile.sessionTurns,
      maxAcceptedMutations: profile.acceptedMutations,
    });
    // The model redesigned with its OWN palette while <html> still carried the
    // direction's, so a section it painted met a library fragment reading
    // --ol-* and the seam showed. The theme drops to the model's values here —
    // before the review and the delivery gate, so what they judge is what
    // ships.
    //
    // The manifest is RESEALED, and that is not optional: the delivery gate
    // compares sha256(html) against manifest.outputHash, so touching the bytes
    // without restamping makes the gate refuse the improved page and fall back
    // to the baseline — the entire creative session discarded, reported as
    // `delivered`. Same seal `quick-visual-repair` uses for the same reason.
    //
    // The object identity is preserved when nothing was adopted, because the
    // fallback below distinguishes candidates by reference and a fresh object
    // would make an unchanged session log a delivery_gate degradation it never
    // suffered.
    lastKnownGood = creative.candidate;
    // Order is the contract. Adoption reads the model's own token names, so it
    // runs before isolation renames them; the repair resolves --olm-* against
    // the page's final --ol-bg, so it runs after both.
    const adoptedHtml = repairInvertedSurfaces(
      isolateModelTokens(adoptModelPalette(creative.candidate.html)),
    );
    if (adoptedHtml !== creative.candidate.html) {
      try {
        lastKnownGood = {
          ...creative.candidate,
          html: adoptedHtml,
          visualEngine: sealAiCompositionOutput(
            creative.candidate.visualEngine,
            adoptedHtml,
          ) as SafeCreativeCandidate["visualEngine"],
        };
      } catch {
        // Adoption is cosmetic. Resealing validates the manifest, and a
        // manifest we cannot reseal must cost the page its seam, never its
        // redesign — the enclosing catch would otherwise drop the whole
        // creative session back to the baseline over a colour.
        deps.recordDegraded?.("creative_session", "palette_adoption_unavailable");
      }
    }
    if (!creative.changed) {
      degraded = true;
      deps.recordDegraded?.("creative_session", creative.stoppedBy);
    }
    // Reported whether or not the page changed: a session that redesigned the
    // page and had every image request refused looks identical to one that
    // never asked, and only this says which.
    for (const code of creative.rejections) deps.recordDegraded?.("creative_session", `tool_${code}`);
  } catch {
    degraded = true;
    deps.recordDegraded?.("creative_session", "internal_error");
  }

  // Se mide y se corrige ANTES de la revisión, no después: lo que Qwen juzga
  // tiene que ser lo que se entrega. Y va aquí, después de adoptar la paleta
  // del modelo, porque hasta ese momento los colores todavía cambian.
  const makeLegible = async (candidate: SafeCreativeCandidate): Promise<SafeCreativeCandidate> => {
    if (!deps.renderCandidate) return candidate;
    try {
      const legible = await repairUnreadableText(candidate.html, deps.renderCandidate);
      if (legible.repaired === 0) return candidate;
      // No es una pérdida, es una corrección — pero queda en la bitácora
      // porque es la única forma de saber cuántas veces el modelo entrega
      // una página con texto invisible.
      deps.recordDegraded?.("advisory_review", "unreadable_text_repaired");
      return {
        ...candidate,
        html: legible.html,
        visualEngine: sealAiCompositionOutput(
          candidate.visualEngine,
          legible.html,
        ) as SafeCreativeCandidate["visualEngine"],
      };
    } catch {
      // Resellar puede fallar; el texto ilegible que quedó lo ve el crítico.
      deps.recordDegraded?.("advisory_review", "unreadable_text_unrepaired");
      return candidate;
    }
  };

  lastKnownGood = await makeLegible(lastKnownGood);

  notify(input, "review");
  try {
    const reviewed = await deps.runAdvisoryReview({
      requestId: input.projectId,
      brief: input.brief,
      candidate: lastKnownGood,
      intent: baseline.intent,
      effort,
    });
    lastKnownGood = reviewed.candidate;
    // La corrección de arriba escribe el color EN LÍNEA sobre cada elemento
    // medido, y una reparación del modelo reescribe secciones enteras: se
    // lleva esos arreglos por delante. Medido — la única de 20 páginas con
    // texto a 1.02:1 fue justo la que pasó por aquí. Sólo se vuelve a medir si
    // la página cambió.
    if (reviewed.repaired) lastKnownGood = await makeLegible(lastKnownGood);
    if (!reviewed.reviewed) deps.recordDegraded?.("advisory_review", "review_unavailable");
    // Aceptar en la primera ronda de tres es éxito, no degradación: lo que se
    // anota es que el crítico NUNCA firmó, y en cuántas rondas se rindió.
    else if (!reviewed.accepted) {
      deps.recordDegraded?.("advisory_review", `unaccepted_after_${reviewed.rounds}_of_${profile.reviewRounds}_${reviewed.exit}`);
    }
  } catch {
    deps.recordDegraded?.("advisory_review", "internal_error");
  }

  notify(input, "delivery_gate");
  const deliver = (candidate: SafeCreativeCandidate) => {
    try {
      return deps.validateDelivery({ html: candidate.html, visualEngine: candidate.visualEngine, leaksAfter: 0 });
    } catch {
      return { ok: false as const, reasonCode: "invalid_composition_metadata" as const };
    }
  };

  // El puente de módulos. Va aquí y no antes porque se aplica a la página que
  // de verdad se entrega, sea la mejorada o la baseline: si sólo lo llevara la
  // mejorada, una entrega que cae hacia atrás perdería el módulo en silencio.
  const modules = modulesFromBrief(input.brief);
  const withModules = (candidate: SafeCreativeCandidate): SafeCreativeCandidate => {
    if (modules.length === 0) return candidate;
    const html = insertModulePlaceholders(candidate.html, modules);
    if (html === candidate.html) return candidate;
    try {
      return {
        ...candidate,
        html,
        visualEngine: sealAiCompositionOutput(candidate.visualEngine, html) as SafeCreativeCandidate["visualEngine"],
      };
    } catch {
      // Un manifiesto que no se puede resellar cuesta el módulo, nunca la
      // página: la puerta compara sha256(html) y devolvería la baseline entera.
      deps.recordDegraded?.("delivery_gate", "module_placeholder_unsealable");
      return candidate;
    }
  };

  // La identidad se compara ANTES de insertar: con el hueco puesto todo
  // candidato es un objeto nuevo, y el reintento se dispararía siempre.
  let candidate = lastKnownGood;
  let chosen = withModules(candidate);
  let validated = deliver(chosen);
  if (!validated.ok && candidate !== baseline.candidate) {
    // An improvement that cannot ship must not cost the page the baseline
    // already earned.
    deps.recordDegraded?.("delivery_gate", validated.reasonCode);
    candidate = baseline.candidate;
    chosen = withModules(candidate);
    degraded = true;
    validated = deliver(chosen);
  }
  if (!validated.ok) {
    deps.recordFailure?.("delivery_gate", validated.reasonCode);
    return { ok: false, stage: "delivery_gate", reasonCode: validated.reasonCode };
  }

  // Mide, no bloquea. Se anota en la página que DE VERDAD se entrega —después
  // de módulos y de un posible regreso a la baseline— porque medir el candidato
  // mejorado diría lo que el usuario no recibió.
  const contract = contractReasonCode(measureContract(chosen.html));
  if (contract) deps.recordDegraded?.("delivery_gate", contract);

  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    title: chosen.title,
    html: chosen.html,
    visualEngine: validated.visualEngine as Extract<VisualEngineProjectMetadata, { route: "section_composition" }>,
    filled: chosen.filled,
    appliedOps: chosen.appliedOps,
    degraded,
  };
}
