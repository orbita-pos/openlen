import { z } from "zod";
import { auth } from "@/auth";
import { getProject, setProjectAssistant } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id]/assistant — current assistant settings for the panel.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const project = await getProject(id, session.user.id);
  if (!project) return json({ error: "not_found" }, 404);
  const a = project.data?.settings?.assistant ?? {};
  return json(
    { enabled: a.enabled ?? false, facts: a.facts ?? "", tone: a.tone ?? "" },
    200,
  );
}

const PatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    facts: z.string().max(4000).optional(),
    tone: z.string().max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Provide at least one of: enabled, facts, tone",
  });

// PATCH /api/projects/[id]/assistant — partial update of the assistant config.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      400,
    );
  }

  const next = await setProjectAssistant(id, session.user.id, parsed.data);
  if (!next) return json({ error: "not_found" }, 404);
  return json(next, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
