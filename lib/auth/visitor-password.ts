// Password hashing for per-site VISITORS (site members, chat users) — NOT the
// platform account on openlen.com (that's auth.ts). bcryptjs, cost 12.
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

// A valid cost-12 bcrypt hash to compare against when the account is unknown,
// so an auth attempt always pays full bcrypt cost and response time can't
// reveal whether the email/username exists.
export const DUMMY_HASH =
  "$2b$12$U5g.9HqlMGI8.St.ytB.UOFWQvr6z7dw7cT/wJPYNWRwoOfNzy/ua";

export function isValidPassword(pw: unknown): pw is string {
  return typeof pw === "string" && pw.length >= 8 && pw.length <= 200;
}

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, BCRYPT_COST);
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash);
}
