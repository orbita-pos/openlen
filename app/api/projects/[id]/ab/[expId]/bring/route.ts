// POST /api/projects/[id]/ab/[expId]/bring — retry 3-way merge of promoted Variant B into draft
// (`{ action: "retry" }`, the default), or give its changes up (`{ action: "discard" }`): the draft stays as it is,
// production stays as it is, and the owner's next publish stops waiting (review item 26).
import { AbLifecycleError, discardWinnerBring, retryBringWinner } from "@/lib/ab/lifecycle";
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Web session only (review item 27): the phone doesn't bring or discard a winner, so no phone key and no CORS.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; expId: string }> },
): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id, expId } = await params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;

  const action = await req
    .json()
    .then((b: unknown) => (b && typeof b === "object" && (b as { action?: unknown }).action === "discard" ? "discard" : "retry"))
    .catch(() => "retry");

  try {
    if (action === "discard") {
      const experiment = await discardWinnerBring({ projectId: id, experimentId: expId });
      return json({ ok: true, status: "discarded", experiment }, 200);
    }
    const result = await retryBringWinner({
      projectId: id,
      experimentId: expId,
      ownerId: acceso.duenoId,
      actorId: userId,
    });
    return json({ ok: true, ...result }, 200);
  } catch (err) {
    if (err instanceof AbLifecycleError) {
      return json({ error: err.code, message: err.message, ...(err.extra ?? {}) }, err.status);
    }
    return json({ error: "bring_failed" }, 500);
  }
}
