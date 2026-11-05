// Tells IndexNow (Bing, Yandex, Seznam, Naver…) that the site's homes changed.
// `deploy.ps1` runs it after the swap; by hand: `npm run seo:indexnow`.
// Needs no secret: it reads the key from the live site (`lib/seo/indexnow.ts`).
//
//   npm run seo:indexnow                      # https://openlen.com
//   npm run seo:indexnow -- https://example.org

import { pingIndexNow } from "../lib/seo/indexnow";

const origin = process.argv[2] || process.env.NEXT_PUBLIC_SITE_URL || "https://openlen.com";

// `exitCode`, not `process.exit()`: on Windows (where deploy.ps1 runs it),
// exiting while fetch's sockets are still closing trips a libuv assertion
// (`UV_HANDLE_CLOSING`, exit 127) instead of returning our code.
pingIndexNow(origin).then(
  (r) => {
    console.log(`IndexNow: HTTP ${r.status} — ${r.meaning}`);
    for (const u of r.urls) console.log(`  ${u}`);
    process.exitCode = r.ok ? 0 : 1;
  },
  (err: unknown) => {
    console.error(`IndexNow: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  },
);
