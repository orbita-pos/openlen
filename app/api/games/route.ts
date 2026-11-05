// WHETHER GAMES ARE ON HERE (spec local 2026-11-05-modo-juego-design, §8.1): the «Juego» card on the start page
// and on the hero asks this, so OPENLEN_GAMES=0 hides the card instead of leaving one that does nothing. No person,
// no data: the hero asks it before anyone signs in.
import { gamesEnabled } from "@/lib/games/enabled";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const on = gamesEnabled();
  return new Response(JSON.stringify(on ? { available: true } : { error: "games_off" }), {
    status: on ? 200 : 404,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
