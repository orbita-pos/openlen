import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

// Route names + product words that must never become a profile URL.
export const RESERVED_HANDLES = new Set([
  "explore", "api", "new", "admin", "projects", "settings", "login", "signin",
  "signup", "logout", "u", "p", "c", "f", "blog", "docs", "support", "business",
  "analytics", "inbox", "messages", "templates", "dev", "terms", "privacy",
  "about", "help", "pricing", "openlen", "me", "static", "assets", "public",
]);

export function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function validateHandle(
  raw: string,
): { ok: true; handle: string } | { ok: false; reason: string } {
  const handle = normalizeHandle(raw);
  if (!HANDLE_RE.test(handle)) {
    return { ok: false, reason: "invalid_format" };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, handle };
}

export async function setUserHandle(
  userId: string,
  raw: string,
): Promise<{ ok: true; handle: string } | { ok: false; reason: string }> {
  const v = validateHandle(raw);
  if (!v.ok) return v;
  // Unique index enforces global uniqueness — catch the violation as "taken".
  try {
    await db
      .update(schema.users)
      .set({ handle: v.handle })
      .where(eq(schema.users.id, userId));
  } catch (err) {
    // Unique-index violation on users.handle → the handle is taken. Any other
    // error is a real failure and must surface, not masquerade as "taken".
    if (err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505") {
      return { ok: false, reason: "taken" };
    }
    throw err;
  }
  return { ok: true, handle: v.handle };
}

export async function getUserByHandle(handle: string) {
  const rows = await db
    .select({
      id: schema.users.id,
      name: schema.users.name,
      handle: schema.users.handle,
      bio: schema.users.bio,
      avatarUrl: schema.users.avatarUrl,
    })
    .from(schema.users)
    .where(eq(schema.users.handle, normalizeHandle(handle)))
    .limit(1);
  const r = rows[0];
  return r && r.handle ? { ...r, handle: r.handle } : null;
}
