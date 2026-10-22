// lib/stripe/preview.ts — WHAT LEN'S `publish` SEES OF STRIPE before the card
// (spec local 2026-10-21-stripe-integration, §6.4): the same reading an owner's
// publish does —what would go to live mode—, without copying anything. A
// missing live key and keys of two accounts are said apart, because Len says
// them differently; any other failure leaves the card without Stripe rather than
// blocking it.

import { FunctionSecretsMissingError } from "@/lib/functions/publish-errors";

import { prepareStripeForPublish, type StripePublishPreview } from "./publish";
import { StripeAccountMismatchError } from "./publish-errors";

export type StripeReleasePreview =
  | { readonly kind: "none" }
  | { readonly kind: "ok"; readonly preview: StripePublishPreview }
  | { readonly kind: "missing_live_key" }
  | { readonly kind: "account_mismatch" };

export interface PreviewDeps {
  texts(projectId: string): Promise<string[]>;
  readonly prepare: (...a: Parameters<typeof prepareStripeForPublish>) => ReturnType<typeof prepareStripeForPublish>;
}

/** What publishing writes: the home's HTML, the public pages and the project's files. */
async function projectTexts(projectId: string): Promise<string[]> {
  const [{ db, schema }, { eq }, { splitPagesForPublish }, { listProjectFiles }] = await Promise.all([
    import("@/lib/db"),
    import("drizzle-orm"),
    import("@/lib/projects/site-pages"),
    import("@/lib/backend/files"),
  ]);
  const [row] = await db.select({ data: schema.projects.data }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  const files = await listProjectFiles(projectId).catch(() => ({}) as Record<string, string>);
  return [row?.data?.html ?? "", ...splitPagesForPublish(row?.data).publicPages.map((p) => p.html), ...Object.values(files)];
}

export async function previewStripeForPublish(projectId: string, liveFunctions: readonly string[], d?: PreviewDeps): Promise<StripeReleasePreview> {
  const deps: PreviewDeps = d ?? { texts: projectTexts, prepare: prepareStripeForPublish };
  try {
    const prepared = await deps.prepare(projectId, { mode: "owner", skipMissingSecrets: false, texts: await deps.texts(projectId), liveFunctions });
    return prepared ? { kind: "ok", preview: prepared.preview } : { kind: "none" };
  } catch (e) {
    if (e instanceof FunctionSecretsMissingError) return { kind: "missing_live_key" };
    if (e instanceof StripeAccountMismatchError) return { kind: "account_mismatch" };
    console.warn("[stripe] the publish preview failed; the card goes without it", projectId, e);
    return { kind: "none" };
  }
}
