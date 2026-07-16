// Pill text for the inbox badges. null = render nothing (zero/invalid).
export function formatBadge(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.floor(n));
}
