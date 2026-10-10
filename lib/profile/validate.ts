// LO QUE SE PUEDE GUARDAR DEL PERFIL (docs/superpowers/specs/2026-10-10-profile-design.md).
// Lo usa `PATCH /api/me/profile` y, antes de mandar, el formulario del perfil:
// la misma regla en los dos lados. Puro.

import { z } from "zod";

export const MAX_NAME = 50;
export const MAX_BIO = 160;
export const MAX_LINKS = 4;
export const MAX_PINNED = 6;

/** «instagram.com/ana» → «https://instagram.com/ana». Lo que ya trae esquema
 *  se queda como está (y `isHttpUrl` decide si vale). */
export function normalizeLink(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

/** Sólo http(s), con un dominio de verdad (con punto). */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** Lo que se enseña de un enlace: el nombre del sitio. */
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const link = z.string().max(300).transform(normalizeLink).refine(isHttpUrl, { message: "invalid_link" });

export const profilePatchSchema = z
  .object({
    name: z.string().trim().max(MAX_NAME).optional(),
    bio: z.string().trim().max(MAX_BIO).optional(),
    links: z.array(link).max(MAX_LINKS).optional(),
    pinnedProjectIds: z.array(z.string().min(1).max(100)).max(MAX_PINNED).optional(),
  })
  .strict();

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

/** El cuerpo de la petición, validado; si no vale, la ruta del campo que falla
 *  («links.1»), para que el formulario marque ése. */
export function parseProfilePatch(body: unknown): { ok: true; patch: ProfilePatch } | { ok: false; path: string } {
  const r = profilePatchSchema.safeParse(body);
  if (r.success) return { ok: true, patch: r.data };
  return { ok: false, path: r.error.issues[0]?.path.join(".") ?? "" };
}
