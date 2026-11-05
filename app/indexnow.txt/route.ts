// The IndexNow key file (`lib/seo/indexnow.ts`). At the root so it validates
// every URL of the host. Dynamic: the key comes from the box's secret at
// request time — built statically it would carry the BUILD machine's secret.
// The middleware leaves it alone (a path with a dot).

import { indexNowKey } from "@/lib/seo/indexnow";

export const dynamic = "force-dynamic";

export function GET(): Response {
  const key = indexNowKey();
  if (!key) return new Response("Not found", { status: 404 });
  return new Response(key, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
