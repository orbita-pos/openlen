import { auth } from "@/auth";
import { deliveryStore } from "@/lib/agent/skills/deliveries";
import { contentTypeOf } from "@/lib/agent/skills/present";
import { exigirAcceso } from "@/lib/projects/acceso";

export const runtime = "nodejs";

// GET /api/projects/<id>/deliveries/<turn>/<file> — a file Len delivered with `present` (spec local
// 2026-10-26-len-skills, §4.9), to whoever can SEE the project; the chat's card links here
// (`deliverableLocation`). Always a download, never rendered on this origin: a delivered .html or .svg
// would otherwise run with the session of whoever opens it.
const TURN = /^[A-Za-z0-9_-]{1,100}$/;
const FILE = /^[0-9a-f]{8}-[\p{L}\p{N}._-]{1,100}$/u;

function decoded(segment: string): string | null {
  if (!segment.includes("%")) return segment;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; turn: string; file: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

  const params = await ctx.params;
  const acceso = await exigirAcceso(params.id, session.user.id, "ver");
  if (acceso instanceof Response) return acceso;

  const turn = decoded(params.turn);
  const file = decoded(params.file);
  if (!turn || !file || !TURN.test(turn) || !FILE.test(file)) return Response.json({ error: "not_found" }, { status: 404 });
  const store = deliveryStore();
  if (!store) return Response.json({ error: "unavailable" }, { status: 503 });
  const bytes = await store.get(`deliveries/${params.id}/${turn}/${file}`);
  if (!bytes) return Response.json({ error: "not_found" }, { status: 404 });

  const name = file.slice(9);
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": contentTypeOf(name),
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
