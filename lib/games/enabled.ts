// THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.1): on by default, like the rest of OpenLen's
// features; only the literal "0" turns it off everywhere — the start card, the birth, and Len's game posture (a
// game is then treated as the app it is).
export function gamesEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_GAMES !== "0";
}
