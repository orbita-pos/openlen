import { z } from "zod";
import { auth } from "@/auth";
import {
  deleteProject,
  getProject,
  renameProject,
  setProjectLogoUrl,
  setProjectStatus,
  setProjectUserBrief,
  dismissDegradations,
} from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id] — load one full project (404 when not yours).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const project = await getProject(id, session.user.id);
  if (!project) return json({ error: "not_found" }, 404);
  return json({ project }, 200);
}

// PATCH /api/projects/[id] — accepts title, status, and/or userBrief. Apply
// only the fields present in the body so the client doesn't have to send all.
const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  // userBrief is the persistent AI context the user writes in the Brief
  // sidebar tab. Empty string clears it (stored as NULL).
  userBrief: z.string().max(4000).optional(),
  // logoUrl is the project's favicon / brand mark. Null clears it; a string
  // sets it. Validated as http(s) URL or data: URI so the inspector can't
  // smuggle in javascript: or file: schemes that the published HTML would
  // happily honor.
  logoUrl: z
    .union([
      z.string().refine(
        (s) => /^(?:https?:|data:image\/)/i.test(s),
        { message: "logoUrl must be an http(s) URL or data:image/… URI" },
      ),
      z.null(),
    ])
    .optional(),
  // Ingestion-degradation notice: the user closed it. Only `true` — there is
  // no un-dismiss, and the record itself is never deleted by this.
  degradationsDismissed: z.literal(true).optional(),
}).refine(
  (v) =>
    v.title !== undefined ||
    v.status !== undefined ||
    v.userBrief !== undefined ||
    v.logoUrl !== undefined ||
    v.degradationsDismissed !== undefined,
  {
    message:
      "Provide at least one of: title, status, userBrief, logoUrl, degradationsDismissed",
  },
);

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
    return json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  }

  let touched = false;
  if (parsed.data.title !== undefined) {
    const ok = await renameProject(id, session.user.id, parsed.data.title);
    if (!ok) return json({ error: "not_found" }, 404);
    touched = true;
  }
  if (parsed.data.status !== undefined) {
    const ok = await setProjectStatus(id, session.user.id, parsed.data.status);
    if (!ok) return json({ error: "not_found" }, 404);
    touched = true;
  }
  if (parsed.data.userBrief !== undefined) {
    const ok = await setProjectUserBrief(
      id,
      session.user.id,
      parsed.data.userBrief,
    );
    if (!ok) return json({ error: "not_found" }, 404);
    touched = true;
  }
  if (parsed.data.logoUrl !== undefined) {
    const ok = await setProjectLogoUrl(
      id,
      session.user.id,
      parsed.data.logoUrl,
    );
    if (!ok) return json({ error: "not_found" }, 404);
    touched = true;
  }
  if (parsed.data.degradationsDismissed !== undefined) {
    const ok = await dismissDegradations(id, session.user.id);
    if (!ok) return json({ error: "not_found" }, 404);
    touched = true;
  }
  if (!touched) return json({ error: "no_op" }, 400);
  return json({ ok: true }, 200);
}

// DELETE /api/projects/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const ok = await deleteProject(id, session.user.id);
  if (!ok) return json({ error: "not_found" }, 404);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
