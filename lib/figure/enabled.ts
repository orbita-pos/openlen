// THE LIVE FIGURES' SWITCH (spec local 2026-11-10-figuras-del-asistente, §6): on by default, like the rest of
// OpenLen's features; only the literal "0" turns them off — every surface then keeps the flat figure. Asked live
// (GET /api/figures, and the published bubble's status answer), so it reaches what is already published.
export function figuresEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_FIGURES !== "0";
}
