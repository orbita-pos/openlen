// WHETHER THE LIVE FIGURES ARE ON HERE (spec local 2026-11-10-figuras-del-asistente, §6): a surface about to draw
// an assistant alive asks this first, so OPENLEN_FIGURES=0 leaves the flat figure everywhere at once. No person, no
// data. The phone app asks it too, from its own origin: hence the CORS of `paraLaApp`, with no key needed.
import { figuresEnabled } from "@/lib/figure/enabled";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = paraLaApp(
  async (): Promise<Response> =>
    new Response(JSON.stringify({ enabled: figuresEnabled() }), { headers: { "content-type": "application/json", "cache-control": "no-store" } }),
);

export const OPTIONS = respuestaPrevia;
