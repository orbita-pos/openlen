import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getTemplate, getTemplateHtml } from "@/lib/templates/store";
import type { LandingPage } from "@/lib/orchestrator/types";
import { createVersion } from "@/lib/projects/versions";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/projects/from-template
// Body: { templateId: string }
//
// Clones a curated template's HTML into a NEW project owned by the caller.
// The HTML lives as a static file under /public/templates/curated/<file>.html;
// we read it from disk and stash it in `project.data.html` so the existing
// publish path (publishProject → publishToDir → nginx wildcard) treats it
// like any other project's output.
//
// The template itself NEVER claims a subdomain. Only the project the user
// publishes does — and that's the user's subdomain (e.g. myco.openlen.com),
// not the template's.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const TEMPLATE_INTENT_MAP: Record<
  string,
  {
    aesthetic: LandingPage["meta"]["aesthetic"];
    palette: LandingPage["meta"]["palette"];
    industry: string;
    audience: string;
    tone: LandingPage["meta"]["intent"]["tone"];
  }
> = {
  // technical-minimal
  mirror:    { aesthetic: "technical-minimal", palette: "emerald-dark", industry: "devtools",  audience: "engineering teams shipping LLM agents",        tone: "technical" },
  anchor:    { aesthetic: "technical-minimal", palette: "indigo-dark",  industry: "devtools",  audience: "backend engineers running staging databases",  tone: "technical" },
  pulse:     { aesthetic: "technical-minimal", palette: "mono-dark",    industry: "devtools",  audience: "frontend engineers debugging production",      tone: "technical" },
  compass:   { aesthetic: "technical-minimal", palette: "mono-dark",    industry: "devtools",  audience: "platform engineers running Kubernetes",        tone: "technical" },
  kiln:      { aesthetic: "technical-minimal", palette: "warm-dark",    industry: "devtools",  audience: "platform / DX teams on large monorepos",       tone: "technical" },
  // editorial
  foundry:   { aesthetic: "refined-editorial", palette: "warm-dark",    industry: "media",     audience: "senior engineers and engineering leaders",     tone: "professional" },
  manuscript:{ aesthetic: "refined-editorial", palette: "mono-light",   industry: "publishing",audience: "long-form writers",                            tone: "professional" },
  aperture:  { aesthetic: "refined-editorial", palette: "mono-dark",    industry: "publishing",audience: "working photographers",                        tone: "professional" },
  quill:     { aesthetic: "refined-editorial", palette: "mono-light",   industry: "publishing",audience: "engineering leaders",                          tone: "professional" },
  loom:      { aesthetic: "refined-editorial", palette: "indigo-dark",  industry: "publishing",audience: "knowledge workers who prefer audio",           tone: "professional" },
  // commerce
  counter:   { aesthetic: "warm-humanist",     palette: "warm-dark",    industry: "commerce",  audience: "indie coffee shops",                           tone: "friendly" },
  mantle:    { aesthetic: "technical-minimal", palette: "mono-light",   industry: "commerce",  audience: "DTC brands",                                   tone: "professional" },
  tessera:   { aesthetic: "warm-humanist",     palette: "warm-dark",    industry: "commerce",  audience: "full-service restaurants",                     tone: "friendly" },
  trove:     { aesthetic: "warm-humanist",     palette: "mono-light",   industry: "commerce",  audience: "makers of handmade goods",                     tone: "friendly" },
  receipts:  { aesthetic: "technical-minimal", palette: "mono-dark",    industry: "devtools",  audience: "indie devs and bootstrapped founders",         tone: "technical" },
};

interface FromTemplateBody {
  templateId?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const body = (await req.json().catch(() => null)) as FromTemplateBody | null;
  if (!body || typeof body.templateId !== "string") {
    return json({ error: "invalid_body" }, 400);
  }

  const entry = await getTemplate(body.templateId);
  if (!entry || entry.status !== "published") {
    return json({ error: "unknown_template", id: body.templateId }, 404);
  }

  // Fetch the canonical HTML body from object storage. Cached at the CDN
  // edge in prod (R2); local FS read in dev.
  const html = await getTemplateHtml(entry.id);
  if (!html) {
    // eslint-disable-next-line no-console
    console.error("[from-template] failed to fetch template body", entry.id);
    return json({ error: "template_body_unavailable" }, 500);
  }

  // Defense in depth: the publish flow rejects HTML containing this marker.
  // Bail early so we don't insert a project that can never be published.
  if (html.includes("data-slot-path=")) {
    return json(
      {
        error: "invalid_template",
        message:
          "Template HTML contains data-slot-path markers — fix the curated file.",
      },
      500,
    );
  }

  const intentMeta = TEMPLATE_INTENT_MAP[entry.id] ?? {
    aesthetic: "technical-minimal" as const,
    palette: "mono-dark" as const,
    industry: "custom",
    audience: "custom",
    tone: "professional" as const,
  };

  const generationId = crypto.randomUUID();
  const now = new Date();

  const data: LandingPage = {
    html,
    css: "",
    images: [],
    meta: {
      title: entry.name,
      description: entry.description,
      generationId,
      generatedAt: now.toISOString(),
      brief: `Curated template: ${entry.name}`,
      intent: {
        industry: intentMeta.industry,
        audience: intentMeta.audience,
        tone: intentMeta.tone,
        complexity: "rich",
        goals: [],
        productName: entry.name,
      },
      aesthetic: intentMeta.aesthetic,
      palette: intentMeta.palette,
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
      aesthetic: intentMeta.aesthetic,
      palette: intentMeta.palette,
      rationale: `Curated template: ${entry.name}`,
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
      title: entry.name,
      brief: data.meta.brief,
      thumbnailUrl: null,
      tags: [entry.id, "template", entry.family],
      status: "draft",
      data,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[from-template] db insert failed", err);
    return json({ error: "db_insert_failed" }, 500);
  }

  // Seed the version history with the freshly-cloned template — gives the
  // user a "back to original" target if they chat the page into oblivion.
  await createVersion({
    projectId,
    html,
    label: `Initial: ${entry.name}`,
    source: "initial",
  }).catch((err: unknown) => {
    // Don't fail the create on a version-write hiccup — the project itself
    // is fine; user just won't have a v0 in their timeline.
    // eslint-disable-next-line no-console
    console.error("[from-template] initial version snapshot failed", err);
  });

  return json({ projectId, title: entry.name }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
