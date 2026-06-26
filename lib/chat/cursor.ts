// Opaque paging cursor over (createdAt ms, id). Ascending order; the client
// passes the last cursor it holds to fetch strictly-newer messages (polling).

export function encodeCursor(m: { createdAt: Date; id: string }): string {
  return Buffer.from(`${m.createdAt.getTime()}.${m.id}`).toString("base64url");
}

export function decodeCursor(s: string): { ms: number; id: string } | null {
  if (!s) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(s, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const dot = decoded.indexOf(".");
  if (dot <= 0) return null;
  const ms = Number(decoded.slice(0, dot));
  const id = decoded.slice(dot + 1);
  if (!Number.isFinite(ms) || id.length === 0) return null;
  return { ms, id };
}
