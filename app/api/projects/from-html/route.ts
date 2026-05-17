import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import type { LandingPage } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-html
// Body: { html: string, title?: string }
//
// Sibling of /api/projects/from-template — instead of looking up a curated
// template's renderer, this endpoint accepts ANY HTML string from the client
// (typically pasted from a claude.ai artifact) and persists it as the new
// project's `data.html`. The Deploy dropdown on /new-v2 then publishes that
// HTML verbatim through `publishProject` → `publishToDir`.
//
// Why we still build a full LandingPage envelope:
// `projects.data` is typed as `jsonb $type<LandingPage>` in
// lib/db/schema.ts. The orchestrator path fills every field (intent, plan,
// cost, etc.). For paste-first projects we stub those — they're not used by
// the publish path, but the TS contract is enforced at this layer.
//
// Safety:
// - 8 MB max HTML size (nginx wildcard limits to 1 MB per request, so the
//   published file can't exceed nginx's cap anyway; cap inputs lower here to
//   keep the DB happy).
// - Reject HTML containing `data-slot-path=` (editor-mode marker; the same
//   guard runs again in publishToDir as defense in depth).
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const MAX_HTML_BYTES = 8 * 1024 * 1024;

interface FromHtmlBody {
  html?: string;
  title?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as FromHtmlBody | null;
  if (!body || typeof body.html !== "string" || body.html.trim().length === 0) {
    return json(
      { error: "invalid_body", message: "html string is required" },
      400,
    );
  }
  const html = body.html;
  if (Buffer.byteLength(html, "utf8") > MAX_HTML_BYTES) {
    return json(
      { error: "too_large", message: "HTML must be under 8 MB" },
      413,
    );
  }
  if (html.includes("data-slot-path=")) {
    return json(
      {
        error: "invalid_html",
        message:
          "HTML contains editor-mode markers (data-slot-path). Save the rendered output instead.",
      },
      400,
    );
  }

  const title =
    (typeof body.title === "string" && body.title.trim()) ||
    extractTitle(html) ||
    "Untitled page";

  const generationId = crypto.randomUUID();
  const now = new Date();

  // Synthetic LandingPage envelope. Only `html` is consumed by publish; the
  // other fields are placeholders that satisfy the TS shape so future code
  // touching `project.data` doesn't have to special-case paste projects.
  const data: LandingPage = {
    html,
    css: "",
    images: [],
    meta: {
      title,
      description: extractDescription(html) ?? "",
      generationId,
      generatedAt: now.toISOString(),
      brief: `Pasted HTML${body.title ? `: ${body.title}` : ""}`,
      intent: {
        industry: "custom",
        audience: "custom",
        tone: "professional",
        complexity: "rich",
        goals: [],
      },
      aesthetic: "technical-minimal",
      palette: "mono-dark",
      blockSequence: [],
    },
    cost: {
      total: 0,
      classify: 0,
      plan: 0,
      fill: 0,
      images: 0,
      assemble: 0,
      gates: 0,
    },
    witnessPath: "",
    adaptiveFastPath: true,
    plan: {
      blockSequence: [],
      aesthetic: "technical-minimal",
      palette: "mono-dark",
      rationale: "Pasted HTML — no orchestrator plan",
      imageNeeds: { hero: false, decorative: 0 },
      factsLedger: {
        prices: [],
        quantities: [],
        people: [],
        places: [],
        dates: [],
        clientLogos: [],
      },
    },
    filledBlocks: [],
  };

  const projectId = crypto.randomUUID();
  try {
    await db.insert(schema.projects).values({
      id: projectId,
      userId: session.user.id,
      title,
      brief: data.meta.brief,
      thumbnailUrl: null,
      tags: ["paste"],
      status: "draft",
      data,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-html] db insert failed", err);
    return json({ error: "db_insert_failed" }, 500);
  }

  return json({ projectId, title }, 200);
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const inner = match[1]?.trim();
  return inner && inner.length > 0 ? inner.slice(0, 200) : null;
}

function extractDescription(html: string): string | null {
  const match = html.match(
    /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i,
  );
  if (!match) return null;
  return match[1]?.slice(0, 500) ?? null;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
