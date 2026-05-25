// scripts/domain-connect/generate-key.ts
//
// One-time helper: generate an RSA-2048 keypair for Domain Connect URL
// signing, print the private key in an env-safe form, and print the
// public key formatted for the TXT record at v1._dc.openlen.com.
//
// Domain Connect specifies that synchronously applied templates with
// variables MUST be digitally signed (RSA-SHA256). The Service Provider
// publishes the public key as a TXT record under `syncPubKeyDomain`; the
// DNS Provider (Cloudflare et al.) fetches it on every apply request to
// verify the signature before showing the user the consent screen.
//
// Run once:
//   npm run domain-connect:keygen
//
// Then:
//   - paste the printed PEM into .env.local (and infra/.env.production)
//     as DOMAIN_CONNECT_SIGNING_KEY
//   - publish the printed TXT record(s) at v1._dc.openlen.com via the
//     Cloudflare dashboard (or `dig +short` to verify after)

import { generateKeyPairSync } from "node:crypto";

const KEY_ID = "v1";
const PUB_KEY_DOMAIN = "dc.openlen.com";
const TXT_CHUNK_SIZE = 240; // safely below the 255-char DNS TXT string limit

function main(): void {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Strip PEM headers + newlines so the public key fits cleanly into one
  // (or a few) TXT record(s) without DNS providers tripping on whitespace.
  const pubBody = publicKey
    .toString()
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");

  const chunks: string[] = [];
  for (let i = 0; i < pubBody.length; i += TXT_CHUNK_SIZE) {
    chunks.push(pubBody.slice(i, i + TXT_CHUNK_SIZE));
  }

  // eslint-disable-next-line no-console
  console.log(`
═══════════════════════════════════════════════════════════════════
 DOMAIN CONNECT SIGNING KEY (id=${KEY_ID})
═══════════════════════════════════════════════════════════════════

STEP 1 — paste this PEM into .env.local and infra/.env.production
         as a single line (preserve the \\n escapes if you replace
         line breaks):

DOMAIN_CONNECT_SIGNING_KEY="${privateKey.toString().replace(/\n/g, "\\n").trim()}"

STEP 2 — publish the public key as TXT record(s) in the Cloudflare
         dashboard for openlen.com (DNS → Add record).

         Common to every record:
           Type:    TXT
           Name:    ${KEY_ID}._dc            (Cloudflare auto-suffixes openlen.com)
           TTL:     Auto
           Proxy:   DNS only (gray cloud)

         Below: ${chunks.length} record${chunks.length === 1 ? "" : "s"} to add. Paste each value EXACTLY (no
         surrounding quotes — Cloudflare wraps them internally).
`);

  chunks.forEach((chunk, i) => {
    // eslint-disable-next-line no-console
    console.log(`         ── Record ${i + 1} of ${chunks.length} ──`);
    // eslint-disable-next-line no-console
    console.log(`         Content:  p=${i + 1},d=${chunk}\n`);
  });

  // eslint-disable-next-line no-console
  console.log(`
STEP 3 — verify the TXT propagated:

    dig +short TXT ${KEY_ID}.${PUB_KEY_DOMAIN}

═══════════════════════════════════════════════════════════════════
`);
}

main();
