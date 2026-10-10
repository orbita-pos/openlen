// /api/me/avatar — LA FOTO DE PERFIL (docs/superpowers/specs/2026-10-10-profile-design.md).
//
// POST   multipart `file`: JPG/PNG/WebP ≤ 5 MB, ya recortada en el navegador
//        (components/profile/avatar-cropper.tsx). Sale UN WebP de 400×400 a
//        `avatars/<userId>-<hash>.webp` en el almacén de siempre: la clave
//        lleva el hash, así que una foto nueva es una URL nueva y ninguna caché
//        enseña la vieja. La de antes se borra sólo si era NUESTRA.
// DELETE vuelve a la de Google (o a la inicial).
//
// El cliente, después, pide `update({ refresh: true })` para que el token lleve
// la foto nueva (lib/profile/session.ts).
import { createHash } from "node:crypto";

import { auth } from "@/auth";
import { OpenLenImageError, processImage } from "@/lib/images";
import { AVATAR_SIZE, avatarKeyFor, avatarKeyFromUrl, avatarOf, checkAvatarFile } from "@/lib/profile/avatar";
import { setAvatarUrl } from "@/lib/profile/identity";
import { consumeToken, RATE_LIMITS, rateLimitedResponse } from "@/lib/rate-limit";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Borra la foto de antes si es nuestra; si falla, no pasa nada (queda un fichero huérfano). */
async function forget(url: string | null, userId: string): Promise<void> {
  const key = url ? avatarKeyFromUrl(url, userId) : null;
  if (!key) return;
  try {
    await getStorage().delete(key);
  } catch (err) {
    console.warn("[avatar] no se pudo borrar la foto vieja", err);
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return json({ error: "missing_file" }, 400);
  const problem = checkAvatarFile({ type: file.type, size: file.size });
  if (problem) return json({ error: problem }, problem === "too_big" ? 413 : 415);

  const rate = consumeToken(`upload:${userId}`, RATE_LIMITS.upload);
  if (!rate.allowed) return rateLimitedResponse(rate, "imágenes");

  let bytes: Buffer;
  try {
    const out = await processImage({
      input: Buffer.from(await file.arrayBuffer()),
      variants: [{ width: AVATAR_SIZE, maxHeight: AVATAR_SIZE, format: "webp", quality: 85 }],
      autoOrient: true,
      withoutEnlargement: true,
    });
    bytes = out.variants[0]!.bytes;
  } catch (err) {
    if (err instanceof OpenLenImageError && err.kind === "decode") return json({ error: "bad_image" }, 422);
    console.warn("[avatar] no se pudo procesar", err);
    return json({ error: "processing_failed" }, 500);
  }

  const key = avatarKeyFor(userId, createHash("sha256").update(bytes).digest("hex").slice(0, 16));
  let url: string;
  try {
    url = (await getStorage().upload({ key, contentType: "image/webp", body: bytes })).url;
  } catch (err) {
    console.warn("[avatar] no se pudo subir", err);
    return json({ error: "upload_failed" }, 500);
  }

  const { previous } = await setAvatarUrl(userId, url);
  if (previous && previous !== url) await forget(previous, userId);
  return json({ avatar: url });
}

export async function DELETE(): Promise<Response> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);
  const { previous, image } = await setAvatarUrl(userId, null);
  await forget(previous, userId);
  return json({ avatar: avatarOf({ avatarUrl: null, image }) });
}
