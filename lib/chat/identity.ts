import bcrypt from "bcryptjs";

const USERNAME_RE = /^[a-z][a-z0-9_]{2,19}$/; // 3–20 chars, starts with a letter
const BCRYPT_COST = 12;

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export function isValidUsername(u: string): boolean {
  return USERNAME_RE.test(u);
}

export function isValidPassword(pw: string): boolean {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 200;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}

export function sanitizeDisplayName(raw: string): string | null {
  const clean = raw.trim().replace(/\s+/g, " ").slice(0, 40).trim();
  return clean.length > 0 ? clean : null;
}
