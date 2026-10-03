// GET /api/a/owner-start?back=/caja — el enlace «Entrar como dueño» de
// la página. Lleva a openlen.com (app/[locale]/(auth)/page-owner/[sub]), donde
// vive la sesión de OpenLen, que comprueba que es el dueño y lo devuelve a su
// página ya dentro.
//
// Existe para que la página pueda enlazarlo con una ruta RELATIVA: no tiene que
// saber en qué dominio vive la app.

import { widgetApiBase } from "@/lib/publish/base-host";
import { safeBackPath } from "@/lib/page-accounts/input";
import { pageSubOf } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const sub = await pageSubOf(req);
  if (!sub) return new Response("Esto sólo funciona en una página publicada.", { status: 404 });
  const back = safeBackPath(new URL(req.url).searchParams.get("back"));
  // Sin idioma: el middleware de la app le pone el del navegador.
  const to = `${widgetApiBase()}/page-owner/${encodeURIComponent(sub)}?back=${encodeURIComponent(back)}`;
  return new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
}
