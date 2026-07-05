export {
  hashPassword,
  verifyPassword,
  isValidPassword,
} from "@/lib/auth/visitor-password";

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/; // 3–20 chars, starts with a letter

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}

export function sanitizeDisplayName(raw: string): string | null {
  const clean = raw.trim().replace(/\s+/g, " ").slice(0, 40).trim();
  return clean.length > 0 ? clean : null;
}

export function deriveOwnerUsername(title: string): string {
  let u = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20)
    .replace(/_+$/g, "");
  if (!isValidUsername(u)) u = "owner";
  return u;
}
