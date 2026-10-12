// LA CAPTURA DE view_page por su URL (10 minutos). Sin sesión: la URL es la llave.
import { getCapture } from "@/lib/mcp/capture-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const c = /^[A-Za-z0-9_-]{43}$/.test(id) ? getCapture(id) : null;
  if (!c) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(new Uint8Array(c.bytes), {
    status: 200,
    headers: { "content-type": c.mimeType, "cache-control": "private, max-age=600", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" },
  });
}
