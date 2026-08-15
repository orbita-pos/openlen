import { parse } from "node-html-parser";

import { isResolvedAssetUrl, type AssetResolutionSource } from "@/lib/generation/asset-contracts";
import type { SafeCreativeCandidate } from "./creative-baseline";

const MAX_IMAGES_PER_PAGE = 3;
const EDIT_ID = "data-openlen-edit-id";

export interface OptionalImageRequest {
  readonly targetId: string;
  readonly subject: string;
  readonly mediaType?: string;
}

export interface OptionalImageToolInput {
  readonly projectId: string;
  readonly candidate: SafeCreativeCandidate;
  readonly requests: readonly OptionalImageRequest[];
}

export interface OptionalImageToolDeps {
  readonly resolve: (intent: {
    projectId: string;
    subject: string;
    mediaType: string;
    required: false;
    identityBearing: false;
  }) => Promise<{ ok: true; url: string; source: AssetResolutionSource } | { ok: false; code: string }>;
  readonly recordImage?: (trace: { targetId: string; outcome: "applied" | "failed"; source?: string; code?: string }) => void;
}

/** Each slot is resolved on its own: a later failure never discards an earlier
 * image, and no failure ever costs the page. */
export async function runOptionalImageTool(
  input: OptionalImageToolInput,
  deps: OptionalImageToolDeps,
): Promise<{ candidate: SafeCreativeCandidate; applied: boolean }> {
  let html = input.candidate.html;
  let applied = false;

  for (const request of input.requests.slice(0, MAX_IMAGES_PER_PAGE)) {
    const document = parse(html);
    const target = document.querySelector(`[${EDIT_ID}="${request.targetId}"]`);
    if (!target) {
      deps.recordImage?.({ targetId: request.targetId, outcome: "failed", code: "unknown_target" });
      continue;
    }

    let resolved: Awaited<ReturnType<OptionalImageToolDeps["resolve"]>>;
    try {
      resolved = await deps.resolve({
        projectId: input.projectId,
        subject: request.subject,
        mediaType: request.mediaType ?? "photo",
        required: false,
        identityBearing: false,
      });
    } catch {
      deps.recordImage?.({ targetId: request.targetId, outcome: "failed", code: "threw" });
      continue;
    }

    if (!resolved.ok) {
      deps.recordImage?.({ targetId: request.targetId, outcome: "failed", code: resolved.code });
      continue;
    }
    if (!isResolvedAssetUrl(resolved.url, resolved.source)) {
      deps.recordImage?.({ targetId: request.targetId, outcome: "failed", code: "unvalidated_asset" });
      continue;
    }

    const existing = target.getAttribute("style")?.trim().replace(/;?$/, ";") ?? "";
    target.setAttribute("style", `${existing}background-image:url('${resolved.url.replace(/[\\']/g, (value) => `\\${value}`)}');`);
    // Marks the section as carrying a resolved asset so a later rewrite can
    // tell a photo the user paid for from decoration the model wrote itself.
    target.setAttribute("data-openlen-asset", resolved.url);
    target.setAttribute("role", "img");
    target.setAttribute("aria-label", request.subject.replaceAll("_", " "));
    html = document.toString();
    applied = true;
    deps.recordImage?.({ targetId: request.targetId, outcome: "applied", source: resolved.source });
  }

  return applied ? { candidate: { ...input.candidate, html }, applied } : { candidate: input.candidate, applied: false };
}
