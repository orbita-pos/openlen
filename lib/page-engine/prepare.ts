import "server-only";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { seedBrandIntoHtml } from "@/lib/business-profiles/seed-html";
import { bindColorsToTokens } from "@/lib/document/bind-colors-to-tokens";
import { ensureSingleH1 } from "@/lib/document/ensure-single-h1";
import { repairUnreadableText } from "@/lib/document/repair-unreadable-text";
import { validateBehaviors } from "@/lib/behaviors/validate";
import { compileCalcRegions } from "@/lib/expr/document";
import { objectiveBreakage } from "@/lib/generation/objective-breakage";
import { sanitizeForPublish } from "@/lib/html-engine";
import { passHtmlGate } from "@/lib/html-gate/document-gate";
import { photographHtml } from "@/lib/imagery/photograph";
import { applyModuleIntent } from "@/lib/projects/module-intent";
import { pageMetaFor } from "@/lib/publish/page-meta-intent";

import type {
  PreparePageOptions,
  PrepareReport,
  PrepareResult,
  StageOutcome,
} from "./contract";

/**
 * EL motor de la página: una tubería ordenada que crear, editar y el Agente
 * comparten, en vez de tres versiones escritas a mano.
 *
 * Medido antes de escribir esto: de las etapas de abajo, la ruta de crear
 * corría todas y el Chat y el Agente NINGUNA salvo la puerta. Se creaba una
 * página verificada y a la primera edición nadie volvía a mirar.
 *
 *   1. imágenes    fotos reales en los huecos que el modelo dejó marcados
 *   2. legibilidad texto que la página pinta y nadie puede leer
 *   3. medición    desborde y geometría, leídos DEL RENDER
 *   4. invariantes exactamente un <h1>; el literal que ya vale un token, atado
 *   5. puerta      saneo + normalización + metadatos + conductas
 *   6. módulos     el hueco que el documento pidió
 *
 * CONTRATO — igual que `lib/transform/index.ts`: las etapas 1-4 son fail-soft.
 * Si Chrome se cuelga o una pasada revienta, el documento sigue su camino y el
 * informe dice por qué; el llamador no necesita `try/catch`. La ÚNICA que puede
 * refusar es la puerta (5), y sólo con `mode: "edit"`.
 *
 * NO opina de gusto. Ni color, ni tipografía, ni ritmo, ni densidad. Sólo
 * rechaza lo roto: eso es lo que deja que una página de terror y una de niños
 * sean distintas de raíz.
 */
export async function preparePage(
  html: string,
  opts: PreparePageOptions,
  deps: PreparePageDeps = {},
): Promise<PrepareResult> {
  const render = deps.render ?? renderVisualQualityViewports;
  const photograph = deps.photograph ?? photographHtml;
  const gate = deps.gate ?? passHtmlGate;
  const stages: StageOutcome[] = [];
  let current = html;

  // ── 1. imágenes ────────────────────────────────────────────────────────
  // Antes que las medidas, no después: el desborde se mide sobre la maqueta de
  // verdad y no sobre un hueco, y el contraste sobre una foto es incierto a
  // propósito. Lo que se juzga tiene que ser lo que se entrega.
  if (process.env.OPENLEN_IMAGERY === "0" || !opts.brief) {
    stages.push({ stage: "imagery", status: "skipped", detail: opts.brief ? "kill_switch" : "no_brief" });
  } else {
    try {
      const shot = await photograph({ html: current, brief: opts.brief });
      if (shot.applied > 0) {
        current = shot.html;
        stages.push({ stage: "imagery", status: "changed", detail: `${shot.applied}` });
      } else {
        stages.push({ stage: "imagery", status: "skipped", detail: "no_slots" });
      }
    } catch (err) {
      stages.push({ stage: "imagery", status: "unavailable", detail: reason(err) });
    }
  }

  // Kill-switch, como `OPENLEN_IMAGERY=0`: si Chrome se rompe en la caja, la
  // página sigue saliendo sin las dos etapas que lo necesitan.
  const renderChecks =
    opts.renderChecks !== false && process.env.OPENLEN_RENDER_CHECKS !== "0";

  // ── 2. legibilidad ─────────────────────────────────────────────────────
  // Se mide EN EL RENDER porque el mismo `color:#8a8a92` es correcto sobre
  // negro e ilegible sobre gris, y ningún análisis del CSS distingue los dos.
  if (!renderChecks) {
    stages.push({ stage: "legibility", status: "skipped", detail: "no_render" });
  } else try {
    const legible = await withDeadline(
      repairUnreadableText(current, render),
      { html: current, repaired: 0 },
    );
    if (legible.repaired > 0) {
      current = legible.html;
      stages.push({ stage: "legibility", status: "changed", detail: `${legible.repaired}` });
    } else {
      stages.push({ stage: "legibility", status: "skipped" });
    }
  } catch (err) {
    stages.push({ stage: "legibility", status: "unavailable", detail: reason(err) });
  }

  // ── 3. medición ────────────────────────────────────────────────────────
  // Se informa, no se actúa: regenerar exige volver a llamar al modelo y eso es
  // decisión —y presupuesto— del llamador.
  let breakage: string[] = [];
  if (!renderChecks) {
    stages.push({ stage: "measure", status: "skipped", detail: "no_render" });
  } else try {
    breakage = objectiveBreakage(await render(current));
    stages.push({ stage: "measure", status: breakage.length ? "changed" : "skipped", detail: breakage.join(" · ") || undefined });
  } catch (err) {
    // No haber medido no es prueba de que no haya rotura, y por eso se anota
    // como `unavailable` en vez de como "sin roturas".
    stages.push({ stage: "measure", status: "unavailable", detail: reason(err) });
  }

  // ── 4+5. invariantes DENTRO de la puerta ───────────────────────────────
  // El orden no es preferencia: `beforeMeta` corre después de sanear y
  // normalizar, y `bindColorsToTokens` cosecha el tema que el normalizador
  // escribe en `<html style>`. Corriéndolo antes no hay tema que cosechar —
  // medido: 8 de 40 documentos salían distintos hasta ponerlo aquí.
  //
  // Y el sembrado de marca va primero porque los invariantes tienen que ver el
  // documento que de verdad se entrega, logo incluido.
  let invariants: StageOutcome = { stage: "invariants", status: "skipped" };
  const beforeMeta = (h: string): string => {
    try {
      const seeded = opts.profile ? seedBrandIntoHtml(h, opts.profile) : h;
      const h1 = ensureSingleH1(seeded);
      const bound = bindColorsToTokens(h1.html);
      // Los cálculos se compilan AQUÍ y no en otro sitio por dos razones
      // medidas: corre después de sanear+normalizar (así el programa se deriva
      // del documento que de verdad se guarda) y ANTES de `validateBehaviors`
      // (document-gate.ts), así que la puerta ve el documento ya compilado y
      // una fórmula rota se trata como cualquier control muerto — al crear
      // avisa, al editar rechaza.
      //
      // `beforeMeta` corre sobre bytes que el saneador ya no vuelve a mirar, y
      // el propio HtmlGateDeps pide que quien lo use demuestre por qué es
      // seguro. Aquí lo es por construcción, no por suerte: lo único que se
      // inyecta es (a) un programa que sale de un AST cerrado y se serializa
      // con los ángulos escapados como `<`, y (b) un valor inicial que se
      // escapa como texto. Ni un `<script>`, ni un `on*`, ni una URL.
      const calc = compileCalcRegions(bound.html);
      invariants = {
        stage: "invariants",
        status: h1.changed || bound.bound > 0 || calc.compiled > 0 ? "changed" : "skipped",
        detail: `h1=${h1.changed ? "fixed" : "ok"} tokens=${bound.bound} calc=${calc.compiled}/${calc.regions}`,
      };
      return calc.html;
    } catch (err) {
      // Un invariante es una mejora, nunca un peaje: si revienta, pasa el
      // documento tal cual y la puerta sigue su curso.
      invariants = { stage: "invariants", status: "unavailable", detail: reason(err) };
      return h;
    }
  };

  const gated = await gate(
    current,
    { sanitize: sanitizeForPublish, beforeMeta },
    {
      render: false,
      seal: false,
      // La asimetría deliberada. Ver el comentario de `PageMode`. Y con
      // `priorHtml` la puerta avisa en vez de bloquear: la comparación de abajo
      // decide, para no cobrarle al usuario un defecto que ya estaba.
      behaviors: opts.mode === "create" || opts.priorHtml !== undefined ? "warn" : "block",
      ...(opts.profile
        ? {
            meta: pageMetaFor({
              provenance: "authored",
              title: opts.title ?? "",
              profile: opts.profile,
            }),
          }
        : {}),
    },
  );
  stages.push(invariants);

  if (!gated.ok) {
    stages.push({ stage: "gate", status: "unavailable", detail: gated.code });
    return {
      ok: false,
      code: gated.code,
      ...(gated.detail ? { detail: gated.detail } : {}),
      report: {
        stages,
        breakage,
        ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
        ...(gated.issues ? { behaviorIssues: [...gated.issues] } : {}),
        modules: [],
      },
    };
  }
  // Sólo lo que ESTA edición rompió. Una conducta que ya venía rota se queda
  // anotada en el informe, no cuesta la edición.
  const issues = [...(gated.issues ?? [])];
  if (opts.mode === "edit" && opts.priorHtml !== undefined && issues.length > 0) {
    const before = new Set(safeBehaviors(opts.priorHtml).map((i) => JSON.stringify(i)));
    const nuevos = issues.filter((i) => !before.has(JSON.stringify(i)));
    if (nuevos.length > 0) {
      stages.push({ stage: "gate", status: "unavailable", detail: "behaviors_invalid" });
      return {
        ok: false,
        code: "behaviors_invalid",
        report: {
          stages,
          breakage,
          ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
          behaviorIssues: nuevos,
          modules: [],
        },
      };
    }
  }

  current = gated.html;
  stages.push({ stage: "gate", status: "changed" });

  // ── 6. módulos ─────────────────────────────────────────────────────────
  // Sobre la página que DE VERDAD se entrega — después de la puerta, porque el
  // saneo puede quitar el hueco que el módulo iba a llenar.
  let modules: readonly string[] = [];
  let moduleSettings: unknown;
  try {
    const intent = applyModuleIntent(opts.settings as never, current);
    modules = intent.enabled;
    moduleSettings = intent.settings;
    stages.push({ stage: "modules", status: modules.length ? "changed" : "skipped", detail: modules.join(",") || undefined });
  } catch (err) {
    stages.push({ stage: "modules", status: "unavailable", detail: reason(err) });
  }

  const report: PrepareReport = {
    stages,
    breakage,
    ...(gated.removed ? { removed: { ...gated.removed, metaRefresh: 0 } } : {}),
    ...(gated.issues ? { behaviorIssues: [...gated.issues] } : {}),
    modules,
    ...(modules.length ? { moduleSettings } : {}),
  };
  return { ok: true, html: current, report };
}

export interface PreparePageDeps {
  readonly render?: typeof renderVisualQualityViewports;
  readonly photograph?: typeof photographHtml;
  readonly gate?: typeof passHtmlGate;
}

/** El render vive dentro de la petición del usuario: un Chrome colgado no puede
 *  quedarse con la página que el modelo ya escribió. */
const RENDER_DEADLINE_MS = 20_000;

function withDeadline<T>(work: Promise<T>, onTimeout: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(onTimeout), RENDER_DEADLINE_MS).unref?.();
    }),
  ]);
}

/** Nunca tira: un validador caído no puede costar una edición. */
function safeBehaviors(html: string): ReturnType<typeof validateBehaviors> {
  try {
    return validateBehaviors(html);
  } catch {
    return [];
  }
}

function reason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}
