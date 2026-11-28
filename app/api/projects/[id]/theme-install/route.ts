// «INSTALAR» A THEME (spec local 2026-11-27-temas-del-workspace, §4.2): the Temas section's button and the card of Len's
// `publish` in a theme project both land here. POST installs — checks the manifest and every scene, measures the contrast
// and raises the glass until the text reads, and keeps the version — and DELETE is «Quitar»: the person's own installation
// is marked removed. Open to every plan (decision 1); only the project's owner installs it.
// Web session only: the phone has no theme layer yet (spec §8), so — as the desktop-apps route — this one doesn't take the
// phone's key, has no app CORS, and isn't on `RUTAS_DE_LA_APP`.
import { z } from "zod";

import { auth } from "@/auth";
import { installTheme, removeTheme } from "@/lib/themes/install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Body = z.object({ locale: z.string().max(16).optional() });

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  let raw: unknown = {};
  try {
    const text = await req.text();
    raw = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input" }, 400);
  const result = await installTheme({ projectId: id, actorId: userId, locale: parsed.data.locale ?? "en" });
  return json(result.body, result.status);
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const result = await removeTheme({ projectId: id, actorId: userId });
  return json(result.body, result.status);
}
