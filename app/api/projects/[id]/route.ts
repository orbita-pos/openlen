import { z } from "zod";
import { auth } from "@/auth";
import {
  deleteProject,
  getProject,
  renameProject,
  setProjectStatus,
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

// PATCH /api/projects/[id] — accepts title and/or status. Apply only the
// fields present in the body so the client doesn't have to send both.
const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
}).refine(
  (v) => v.title !== undefined || v.status !== undefined,
  { message: "Provide at least one of: title, status" },
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
