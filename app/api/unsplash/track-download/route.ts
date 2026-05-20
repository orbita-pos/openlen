import { auth } from "@/auth";

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/unsplash/track-download — pings Unsplash's download_location
// for a photo the user just chose. Per Unsplash API guidelines:
//
//   "When making an API call to download a photo, your application must
//    trigger a download per the guidelines."
//
// We expose this as a separate endpoint (rather than calling at search
// time) so we only track photos the user actually USED, not just viewed.
// Fire-and-forget from the client; failure here doesn't block the user.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

const UNSPLASH_HOST = "api.unsplash.com";

interface TrackBody {
  downloadLocation?: string;
}

export async function POST(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const apiKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!apiKey) {
    // No key → demo mode → nothing to track. Return 204 so the client
    // doesn't treat this as an error.
    return new Response(null, { status: 204 });
  }

  const body = (await req.json().catch(() => null)) as TrackBody | null;
  const loc = body?.downloadLocation;
  if (typeof loc !== "string" || loc.length === 0) {
    return json({ error: "missing_downloadLocation" }, 400);
  }

  // Defense: only ping URLs that point at Unsplash's API. Without this
  // check, an attacker could use our server as a credentialed proxy.
  let parsed: URL;
  try {
    parsed = new URL(loc);
  } catch {
    return json({ error: "invalid_url" }, 400);
  }
  if (parsed.host !== UNSPLASH_HOST) {
    return json({ error: "invalid_host" }, 400);
  }

  try {
    await fetch(parsed.toString(), {
      headers: {
        Authorization: `Client-ID ${apiKey}`,
        "Accept-Version": "v1",
      },
    });
  } catch (err) {
    // Tracking is best-effort. If Unsplash is down or rate-limits us, the
    // user's photo still works — we just miss this analytics ping.
    // eslint-disable-next-line no-console
    console.warn("[unsplash/track-download] ping failed", err);
  }

  return new Response(null, { status: 204 });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
