import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { ProjectData } from "@/lib/projects/types";
import { validatePageSlug } from "@/lib/projects/site-pages";
import { getSection, getSectionHtml } from "@/lib/sections/store";
import {
  getCreditState,
  debitCredits,
  estimateCredits,
  creditsForUsage,
} from "@/lib/credits";
import { resolveAIProvider, type AIModel } from "@/lib/ai-provider";
import { GeminiProvider, type Message } from "@/lib/ai-gateway";
import { detectSlotPath } from "@/lib/html-engine";
import {
  extractHostPalette,
  extractSectionStyle,
  spliceSectionStyle,
  validateRecolouredCss,
  buildMatchPrompt,
} from "@/lib/sections/match-fragment";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sections/prepare
// Body: { projectId, slug, page? }   (page = site-page slug the canvas shows)
//
// "Use on my page" — the section library now MATCHES BEFORE inserting: a section
// only ever lands in the page already recoloured to the host palette (raw insert
// was rejected by the user — "no es worth it que se agregue sin el match"). This
// recolours the section's OWN scoped fragment (not the stored page) and RETURNS
// it for the client to drop into the live iframe. It does NOT save the project —
// the insert round-trips the matched fragment through the normal html-changed
// save path. Credits are debited here (one Gemini call per use).
//
// Companion to lib/sections/match-fragment.ts (deterministic scaffolding) — same
// helpers the old in-place /match used, but spliced into the FRAGMENT.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const SYSTEM_PROMPT =
  "You are a senior product designer. You recolour one landing-page section's stylesheet so it sits natively inside a host page, with the eye of Linear/Vercel/Stripe. You change colours only; you never touch layout, copy, or structure. You output raw CSS only — never markdown fences, never HTML.";

const STREAM_TIMEOUT_MS = 120_000;

interface Body {
  projectId?: string;
  slug?: string;
  model?: string;
  /** Multi-page: slug of the site page being edited — its html (not home's)
   *  is the palette source. Absent/unknown = home. */
  page?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const userId = session.user.id;

  const body = (await req.json().catch(() => null)) as Body | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!projectId || !slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return json({ error: "invalid_body", message: "projectId + slug required" }, 400);
  }

  // Section must exist + be published. The fragment is the host-safe, scoped
  // body the gallery inserts.
  const section = await getSection(slug);
  if (!section || section.status !== "published") {
    return json({ error: "section_not_found" }, 404);
  }
  const fragment = await getSectionHtml(slug);
  if (fragment === null) {
    return json({ error: "section_html_unavailable" }, 502);
  }

  // Host palette from the document the canvas is actually showing — home, or
  // data.pages[slug] when the body names a site page. A stale/deleted slug
  // just falls back to home: this only steers the palette, and subpages are
  // born from home's shell so the palettes track anyway.
  const rows = await db
    .select({ data: schema.projects.data })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  const existing = rows[0];
  if (!existing) return json({ error: "not_found" }, 404);
  const data = existing.data as ProjectData | null;
  let pageHtml = data?.html ?? "";
  if (typeof body?.page === "string" && body.page.length > 0) {
    const check = validatePageSlug(body.page);
    const pg = check.ok ? data?.pages?.[check.slug] : undefined;
    if (pg?.html) pageHtml = pg.html;
  }
  const palette = extractHostPalette(pageHtml);

  // The fragment's own scoped stylesheet (the [data-sec="slug"] rules).
  const sectionStyle = extractSectionStyle(fragment, slug);

  // If we can't read a palette, or the section has no scoped <style> to recolour
  // (pure-Tailwind sections inherit the host's CDN), there's nothing to match —
  // the fragment is already host-safe, so return it untouched, free of charge.
  // Same data-slot-path guard as the matched path (defense in depth — sections
  // are slot-marker-free at ingest, and the save PATCH rejects them too).
  if ((!palette.bg && !palette.fg && !palette.accent) || !sectionStyle) {
    if (detectSlotPath(fragment)) {
      return json({ error: "bad_fragment", message: "section carries editor markers" }, 422);
    }
    return json({ html: fragment, credits: 0, matched: false }, 200);
  }

  // Recolour is a mechanical CSS task (rewrite colour values, keep structure) —
  // Flash does it well in ~15-30s vs Pro's 1-2min, and at a fraction of the
  // cost, which is what keeps assembly cheap. Pro stays available via the body.
  const aiModel: AIModel = body?.model === "gemini-pro" ? "gemini-pro" : "gemini-flash";
  const PROVIDER = resolveAIProvider(aiModel);
  if (!PROVIDER.key) return json({ error: "provider_unconfigured", message: `${PROVIDER.label} API key missing` }, 500);

  const { balance } = await getCreditState(userId);
  if (balance < 1) {
    return json({ error: "no_credits", message: "Te quedaste sin créditos este mes. Esperá al reset o pasá a Pro." }, 402);
  }

  const userPrompt = buildMatchPrompt(palette, sectionStyle.css, slug);
  const messages: Message[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), STREAM_TIMEOUT_MS);
  let text = "";
  let usage: { inputTokens: number; outputTokens: number } | null = null;
  let providerError: string | null = null;
  try {
    const provider = new GeminiProvider(PROVIDER.key);
    const events = provider.stream(
      { model: PROVIDER.model, messages, maxOutputTokens: 16_384, temperature: 0.4 },
      { signal: abort.signal },
    );
    for await (const ev of events) {
      if (ev.type === "text_delta") text += ev.text;
      else if (ev.type === "usage") usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens };
      else if (ev.type === "done") {
        if (ev.stopReason.kind === "error") providerError = ev.stopReason.error;
        break;
      }
    }
  } catch (err) {
    return json({ error: "stream_failed", message: err instanceof Error ? err.message : String(err) }, 502);
  } finally {
    clearTimeout(timer);
  }
  if (providerError) return json({ error: "provider_error", message: `${PROVIDER.label}: ${providerError}` }, 502);

  const newCss = stripFences(text);
  const check = validateRecolouredCss(newCss, slug);
  if (!check.ok) {
    return json({ error: "bad_output", message: `Match produced invalid CSS (${check.reason}). Try again.` }, 422);
  }

  const matchedFragment = spliceSectionStyle(fragment, slug, newCss);
  if (!matchedFragment || detectSlotPath(matchedFragment)) {
    return json({ error: "splice_failed", message: "couldn't apply the recoloured styles" }, 500);
  }

  const credits = usage
    ? creditsForUsage(usage.inputTokens, usage.outputTokens, PROVIDER.rate)
    : estimateCredits(userPrompt.length, newCss.length, PROVIDER.rate);
  await debitCredits(userId, credits);

  return json({ html: matchedFragment, credits, matched: true }, 200);
}

function stripFences(s: string): string {
  let out = s.trim();
  out = out.replace(/^```(?:css)?[\t ]*\r?\n?/i, "");
  out = out.replace(/\r?\n?[\t ]*```\s*$/i, "");
  return out.trim();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
