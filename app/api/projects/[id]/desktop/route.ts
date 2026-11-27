// «INSTALAR EN EL ESCRITORIO» (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §4.4, §4.6): the Publicar menu's button
// and the window's «Actualizar» both land here. POST installs or updates through the same gates as publishing (security
// review, compile, data changes, functions) and answers their codes — the person's tap is the approval; GET says what is
// installed and whether the project moved on since (the owner's), and `GET ?for=publish` says to whoever can publish
// whether anyone has it installed (a boolean, nothing more); DELETE is «Quitar del escritorio».
// Web session only: the phone neither installs nor opens these (it has no window to install into), so — as the A/B
// routes — this one doesn't take the phone's key, has no app CORS, and isn't on `RUTAS_DE_LA_APP`.
import { z } from "zod";

import { auth } from "@/auth";
import { desktopAppState, desktopInstalledForPublish, installDesktopApp, removeDesktopApp } from "@/lib/desktop-apps/install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Body = z.object({
  locale: z.string().max(16).optional(),
  acceptSecurityFingerprint: z.string().max(200).optional(),
  confirmFingerprint: z.string().max(200).optional(),
  copyDraftData: z.boolean().optional(),
  skipMissingSecrets: z.boolean().optional(),
  /** Sent by the window's «Actualizar»: it only updates, so an app removed elsewhere is a 409 and not installed again. */
  fromWindow: z.boolean().optional(),
});

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
  const { locale, ...rest } = parsed.data;
  const result = await installDesktopApp({ projectId: id, actorId: userId, locale: locale ?? "en", requestHost: req.headers.get("host"), ...rest });
  return json(result.body, result.status);
}

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  // `?for=publish` is the publish dialog's question (spec §5): is there an app on the desktop sharing the production data?
  // Anyone who can publish gets the boolean; the owner's read of what is installed stays the owner's.
  if (new URL(req.url).searchParams.get("for") === "publish") {
    const publish = await desktopInstalledForPublish({ projectId: id, actorId: userId });
    return json(publish.body, publish.status);
  }
  const result = await desktopAppState({ projectId: id, actorId: userId });
  return json(result.body, result.status);
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const result = await removeDesktopApp({ projectId: id, actorId: userId });
  return json(result.body, result.status);
}
