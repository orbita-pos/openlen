// Len's tool `create_ab_variant` (Plan 3): creates an isolated Variant B draft
// on branch `ab/<expId>` (never touching the owner's draft or production) and
// optionally applies the proposed Variant B HTML directly into the worktree copy
// so the owner can inspect A vs B side-by-side and launch 50/50 in one click.
// Cache effect: declared only when OPENLEN_AB_TESTING=1; never mutates prior turns.
import { eq } from "drizzle-orm";

import { abTestingEnabled } from "@/lib/ab/enabled";
import { AbLifecycleError, createAbDraft } from "@/lib/ab/lifecycle";
import { normalizePrimaryMetric, normalizeTargetPath } from "@/lib/ab/store";
import { commitAbWorktree } from "@/lib/ab/worktree";
import { CLAVE_TOOL_RESULT, fallo } from "@/lib/agent/ficheros/resultado";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { db, schema } from "@/lib/db";

export const CREATE_AB_VARIANT = "create_ab_variant";

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

export async function runCreateAbVariant(
  session: AgentSession,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  if (!abTestingEnabled()) {
    const r = fallo("A/B testing is not enabled on this server.");
    return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
  }
  const name = typeof args.name === "string" ? args.name.trim() : "";
  const variantBHtml = typeof args.variant_b_html === "string" ? args.variant_b_html.trim() : "";
  if (!name || !variantBHtml) {
    const r = fallo("name and variant_b_html are required.");
    return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
  }

  const hypothesis = typeof args.hypothesis === "string" ? args.hypothesis.trim() : null;
  const targetPath = normalizeTargetPath(
    typeof args.target_path === "string" ? args.target_path : "/",
  );
  const primaryMetric = normalizePrimaryMetric(args.primary_metric);
  const actorId = session.personId ?? session.userId;

  try {
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
      const [copyRow] = await db
        .select({ data: schema.projects.data })
        .from(schema.projects)
        .where(eq(schema.projects.id, created.copyProjectId))
        .limit(1);
      if (copyRow?.data) {
        const nextData =
          targetPath === "/"
            ? { ...copyRow.data, html: variantBHtml }
            : {
                ...copyRow.data,
                pages: {
                  ...(copyRow.data.pages ?? {}),
                  [targetPath.slice(1)]: {
                    ...(copyRow.data.pages?.[targetPath.slice(1)] ?? { title: name }),
                    html: variantBHtml,
                  },
                },
              };
        await db
          .update(schema.projects)
          .set({ data: nextData, updatedAt: new Date() })
          .where(eq(schema.projects.id, created.copyProjectId));
        await commitAbWorktree(created.copyProjectId, session.userId, created.id);
      }
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
    const msg =
      err instanceof AbLifecycleError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Could not create A/B test draft.";
    const r = fallo(msg);
    return { response: { ok: false, error: r.error, [CLAVE_TOOL_RESULT]: r.texto } };
  }
}
