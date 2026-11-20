// WHETHER A/B TESTING IS ON HERE (review item 28): the chat's A/B cards ask this ONCE, so OPENLEN_AB_TESTING off means no
// request and no polling at all — they used to ask the project's own route every minute, in every chat, to learn «off».
// No person, no data. Same shape as GET /api/games.
import { abTestingEnabled } from "@/lib/ab/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const on = abTestingEnabled();
  return new Response(JSON.stringify(on ? { available: true } : { error: "ab_off" }), {
    status: on ? 200 : 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
