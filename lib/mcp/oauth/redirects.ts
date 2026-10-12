// LAS REDIRECCIONES DE OAUTH. Exactas, salvo el puerto en loopback (las CLI
// abren un servidor en un puerto que eligen al vuelo: Claude Code, Codex,
// Gemini CLI, VS Code 33418, Cursor 8787, OpenCode 19876). Nunca se redirige a
// algo que no esté registrado.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parse(uri: string): URL | null {
  try {
    return new URL(uri);
  } catch {
    return null;
  }
}

/** https a cualquier host; http sólo a loopback; esquemas privados con punto
 *  (RFC 8252 §7.1, `com.example.app:/cb`). Sin fragmento. */
export function isAcceptableRedirectUri(uri: string): boolean {
  const u = parse(uri);
  if (!u || u.hash) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  const scheme = u.protocol.slice(0, -1);
  return scheme.includes(".") && /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

export function redirectUriMatches(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  const want = parse(requested);
  if (!want || want.protocol !== "http:" || !LOOPBACK.has(want.hostname)) return false;
  return registered.some((r) => {
    const reg = parse(r);
    return Boolean(reg && reg.protocol === "http:" && LOOPBACK.has(reg.hostname) && reg.pathname === want.pathname && reg.search === want.search);
  });
}
