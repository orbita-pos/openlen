// AN INSTALLED TOOL'S ICON (spec local 2026-11-04-herramientas-hechas-por-len, §4.11): for the rail and the Herramientas
// page, even when the tool can't open. It comes from openlen.com, so an SVG Len wrote is sent with a CSP sandbox:
// as an <img> it draws, and opened on its own it can never run as a page here.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { isBlobPointer } from "@/lib/files/blob-pointer";
import { toolsEnabled } from "@/lib/tools/enabled";
import { installationById, readRelease } from "@/lib/tools/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export const GET = paraLaApp(async (req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId || !toolsEnabled()) return notFound();
  const { id } = await params;
  const row = await installationById(id);
  if (!row || row.personId !== userId) return notFound();
  const file = (await readRelease(row.releaseSha))?.[row.iconPath];
  if (!file) return notFound();
  const body = isBlobPointer(file.content) ? new Uint8Array(await (await import("@/lib/files/blob")).getBlob(file.content)) : file.content;
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": file.contentType,
      // The URL carries the release (`?v=`): a new icon is a new URL.
      "cache-control": "private, max-age=31536000, immutable",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
});

export const OPTIONS = respuestaPrevia;
