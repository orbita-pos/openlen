import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { extractLogoFromHtml } from "./extract-logo";
import { uploadDataUriToStorage } from "./upload-data-uri";

// ─────────────────────────────────────────────────────────────────────────────
// Resolve a project's effective logo URL at publish time.
//
// Precedence on a PAGE:
//   1. The explicit `projects.logoUrl` column (user-chosen via inspector,
//      or extracted from a prior publish). Used as-is.
//   2. Auto-extracted from the current HTML's <link rel="icon"> /
//      <meta og:image>. data: URIs get uploaded to object storage so the
//      DB doesn't bloat with base64 — anything that fails to upload stays
//      as the original raw URI (still works in the browser).
//   3. Null when nothing matched.
//
// In an APP the shell is code (there is no inspector to choose a logo, Len
// writes it like any file), so what it declares NOW comes first and the
// column is only the fallback for a shell that declares nothing. Before
// 27/11 the column won here too: an app's first publish saved OpenLen's
// default mark (the shell had no icon yet), and every later publish swapped
// the icon Len then wrote for that saved mark.
//
// When this function discovers a new logo (#2, or an app's own that differs
// from the saved one), it persists the resolved URL back to the DB, so the
// project's lists show it and a page's next publish hits the fast path.
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolveLogoParams {
  projectId: string;
  userId: string;
  /** Current logoUrl column value — null if the project has no explicit
   *  choice yet. */
  currentLogoUrl: string | null;
  /** Project HTML to scan (a page's only when currentLogoUrl is null). */
  html: string;
  /** An app (`data.app`): the icon its shell declares wins over the column. */
  isApp?: boolean;
}

export async function resolveProjectLogo(
  params: ResolveLogoParams,
): Promise<string | null> {
  if (params.currentLogoUrl && !params.isApp) return params.currentLogoUrl;

  const extracted = extractLogoFromHtml(params.html);
  if (!extracted) return params.currentLogoUrl ?? null;

  let resolvedUrl: string;
  if (extracted.isDataUri) {
    const uploaded = await uploadDataUriToStorage(extracted.href, "logos");
    // If the upload fails (e.g. malformed mime), keep the data: URI — the
    // page still renders, we just don't get the DB / publish-HTML slim-down.
    resolvedUrl = uploaded ?? extracted.href;
  } else {
    resolvedUrl = extracted.href;
  }
  if (resolvedUrl === params.currentLogoUrl) return resolvedUrl;

  // Persist so the next publish doesn't re-extract. Soft-fail — the
  // publish itself doesn't depend on this write.
  try {
    await db
      .update(schema.projects)
      .set({ logoUrl: resolvedUrl, updatedAt: new Date() })
      .where(
        and(
          eq(schema.projects.id, params.projectId),
          eq(schema.projects.userId, params.userId),
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[resolveProjectLogo] persist failed", err);
  }

  return resolvedUrl;
}
