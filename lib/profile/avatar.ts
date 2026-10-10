// QUÉ FOTO ES LA DE CADA PERSONA, en UN sitio
// (docs/superpowers/specs/2026-10-10-profile-design.md). La que subió
// (`users.avatarUrl`), si no la de Google (`users.image`), y si no ninguna: la
// inicial. Todo lo que pinta una persona —el botón de cuenta, los miembros, el
// chat, los hilos, Explorar, el perfil— recibe esto ya resuelto del servidor.
// Puro: lo usan el servidor y el navegador.

export const AVATAR_SIZE = 400;
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function avatarOf(u: { readonly avatarUrl?: string | null; readonly image?: string | null }): string | null {
  return u.avatarUrl || u.image || null;
}

const safeId = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, "");

/** `avatars/<userId>-<hash>.webp`: el hash hace que una foto nueva sea una URL nueva. */
export function avatarKeyFor(userId: string, hash: string): string {
  return `avatars/${safeId(userId)}-${hash}.webp`;
}

/** La clave de una foto NUESTRA de esa persona, o null. Lo que no casa (la de
 *  Google, la del seed, la de otro) no se borra nunca. */
export function avatarKeyFromUrl(url: string, userId: string): string | null {
  const id = safeId(userId);
  if (!id) return null;
  const path = url.split(/[?#]/)[0] ?? "";
  const m = /(?:^|\/)(avatars\/([A-Za-z0-9_-]+)-[0-9a-f]{8,64}\.webp)$/.exec(path);
  return m && m[2] === id ? m[1]! : null;
}

export type AvatarFileProblem = "bad_type" | "too_big";

export function checkAvatarFile(f: { readonly type: string; readonly size: number }): AvatarFileProblem | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(f.type)) return "bad_type";
  if (f.size > AVATAR_MAX_BYTES) return "too_big";
  return null;
}
