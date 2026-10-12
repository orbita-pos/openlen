// PKCE S256 (RFC 7636): base64url(sha256(verifier)) === challenge, en tiempo
// constante. El verifier son 43-128 caracteres de [A-Za-z0-9-._~].
import crypto from "node:crypto";

const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

export function verifyS256(verifier: string, challenge: string): boolean {
  if (!VERIFIER.test(verifier)) return false;
  const got = Buffer.from(crypto.createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const want = Buffer.from(challenge);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
