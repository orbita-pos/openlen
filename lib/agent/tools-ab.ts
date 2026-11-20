// Len's tool `create_ab_variant` (Plan 3): creates an isolated Variant B draft
// on branch `ab/<expId>` (never touching the owner's draft or production) and
// optionally applies the proposed Variant B HTML directly into the worktree copy
// so the owner can inspect A vs B side-by-side and launch 50/50 in one click.
// Cache effect: declared only when OPENLEN_AB_TESTING=1; never mutates prior turns.
import { abTestingEnabled } from "@/lib/ab/enabled";
import { AbLifecycleError, cancelAbDraft, createAbDraft } from "@/lib/ab/lifecycle";
import { normalizePrimaryMetric, normalizeTargetPath } from "@/lib/ab/store";
import { commitAbWorktree } from "@/lib/ab/worktree";
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";
import { rutaDePagina } from "@/lib/agent/ficheros/sitio";
import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";

import { CREATE_AB_VARIANT } from "@/lib/agent/tools-ab-name";

export { CREATE_AB_VARIANT };

export const CREATE_AB_VARIANT_DECLARATION = {
  name: CREATE_AB_VARIANT,
  description:
    "Creates an isolated A/B test draft (Variant B) for this published page without modifying the owner's draft or live site. " +
    "Use when the owner asks to test an alternative headline, hero, CTA, or layout against the current published page. " +
    "Pass the complete Variant B HTML in `variant_b_html` (based on the current page with your proposed change). " +
    "The owner will review A vs B side-by-side and launch the 50/50 split explicitly; never claim the test is live until they launch it.",
  parameters: {
    type: "OBJECT",
    properties: {
      name: {
        type: "STRING",
        description: "Short descriptive name for the A/B test (e.g. 'Direct Hero CTA').",
      },
      hypothesis: {
        type: "STRING",
        description: "One-sentence hypothesis of why Variant B should convert better.",
      },
      target_path: {
        type: "STRING",
        description: "Target path to test: '/' (default, home page) or '/<slug>' for a site subpage.",
      },
      primary_metric: {
        type: "STRING",
        enum: ["conversion_any", "form_submit", "cta_click"],
        description: "Primary conversion metric: conversion_any (default), form_submit, or cta_click.",
      },
      variant_b_html: {
        type: "STRING",
        description: "Complete HTML document for Variant B of the target page.",
      },
    },
    required: ["name", "variant_b_html"],
  },
} as const;

/** Variant B is written into the COPY through `guardarFichero`, the door Write and Edit use (review item 1): the page
 *  gate (size, format, `data-slot-path` rejected, `data-op-id` stripped) and the compare-and-swap writer of
 *  `projects.data`. A bare `UPDATE projects SET data` here would skip the gate and the CAS (invariant I4, pinned by
 *  `lib/projects/escritores-de-data.test.ts`). */
export async function runCreateAbVariant(
  session: AgentSession,
  args: Record<string, unknown>,
  /** The turn's deps (the tool loop passes them); absent = the real ones. */
  deps?: AgentDeps,
): Promise<ToolOutcome> {
  const refuse = (msg: string): ToolOutcome => {
    const r = fallo(msg);
    return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
  };
  if (!abTestingEnabled()) return refuse("A/B testing is not enabled on this server.");
  // Apps, games and tools aren't static HTML. The declaration isn't offered there either (`declaracionesDeLaApp`), so
  // this only answers a turn whose list was built before the project became one.
  if (session.app || session.game || session.tool) {
    return refuse("A/B testing supports static HTML sites (including multi-page), not apps, games or tools. Nothing was created.");
  }
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const variantBHtml = typeof args.variant_b_html === "string" ? args.variant_b_html.trim() : "";
  if (!name || !variantBHtml) return refuse("name and variant_b_html are required.");

  const hypothesis = typeof args.hypothesis === "string" ? args.hypothesis.trim() : null;
  const targetPath = normalizeTargetPath(
    typeof args.target_path === "string" ? args.target_path : "/",
  );
  const primaryMetric = normalizePrimaryMetric(args.primary_metric);
  const actorId = session.personId ?? session.userId;

  try {
    // Refuses (not published, an app, a missing page, one already active) BEFORE it creates anything.
    const created = await createAbDraft({
      projectId: session.projectId,
      ownerId: session.userId,
      actorId,
      name,
      hypothesis,
      targetPath,
      primaryMetric,
    });

    if (created.copyProjectId) {
      const writerDeps = deps ?? (await import("@/lib/agent/tools")).realDeps();
      const page = targetPath === "/" ? null : targetPath.slice(1);
      const copy = await writerDeps.loadProject(created.copyProjectId, session.userId);
      if (!copy) {
        await cancelAbDraft({ projectId: session.projectId, experimentId: created.id }).catch(() => undefined);
        return refuse("Could not open the Variant B copy. The test was not created.");
      }
      // The copy is a hidden project of the same owner; the writer's session points at it, never at the owner's draft.
      const copySession = {
        projectId: created.copyProjectId,
        userId: session.userId,
        page,
        ownerEmail: null,
        imageEditsThisTurn: 0,
        photoSearchesThisTurn: 0,
        busquedasVaciasSeguidas: 0,
      } satisfies AgentSession;
      const { guardarFichero } = await import("@/lib/agent/herramientas-de-ficheros");
      const ruta = rutaDePagina(page);
      const saved = await guardarFichero(copySession, writerDeps, copy.data, ruta, variantBHtml, {
        crea: false,
        etiqueta: `create_ab_variant ${ruta}`,
      });
      if (!saved.ok) {
        // A Variant B the gate refuses is no variant: the empty draft goes, and Len reads why.
        await cancelAbDraft({ projectId: session.projectId, experimentId: created.id }).catch(() => undefined);
        return refuse(`Variant B was not saved: ${saved.error}. The test was not created.`);
      }
      await commitAbWorktree(created.copyProjectId, session.userId, created.id);
    }

    const summary =
      `Created isolated A/B test draft "${created.name}" (${created.id}) for ${created.targetPath}. ` +
      `Your live site and main draft were not modified. Tell the owner they can preview Control A vs Variant B in Insights and launch the 50/50 test in one click.`;
    return {
      response: {
        ok: true,
        experimentId: created.id,
        targetPath: created.targetPath,
        primaryMetric: created.primaryMetric,
        status: created.status,
        [CLAVE_TOOL_RESULT]: summary,
      },
    };
  } catch (err) {
    return refuse(
      err instanceof AbLifecycleError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not create A/B test draft.",
    );
  }
}
