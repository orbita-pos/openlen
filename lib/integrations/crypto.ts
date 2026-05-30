import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Token-at-rest encryption for stored OAuth access tokens (aes-256-gcm).
//
// The key is derived from NEXTAUTH_SECRET via HKDF, so no new secret is
// required and provider access tokens (which can create repos / deployments
// in a user's account) never sit in the DB as plaintext. NEXTAUTH_SECRET is
// already mandatory for cookie signing, so it is always present in any real
// deployment.
//
// Stored format: "v1:" + base64( iv(12) | authTag(16) | ciphertext ).
// ─────────────────────────────────────────────────────────────────────────────

const VERSION = "v1";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "NEXTAUTH_SECRET is required to encrypt integration tokens.",
    );
  }
  const derived = hkdfSync(
    "sha256",
    secret,
    "openlen-integration-tokens", // salt
    "aes-256-gcm", // info
    32,
  );
  return Buffer.from(derived);
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const sep = stored.indexOf(":");
  const version = sep === -1 ? "" : stored.slice(0, sep);
  const payload = sep === -1 ? "" : stored.slice(sep + 1);
  if (version !== VERSION || !payload) {
    throw new Error("Unrecognized integration-token ciphertext format.");
  }
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString(
    "utf8",
  );
}
