/**
 * CREDENCIALES EN LA MEMORIA — el «memory content appears to contain a
 * credential or API key» de Claude Code. La memoria va en cada turno y la ven
 * los miembros del proyecto: una clave ahí es una clave filtrada.
 *
 * Puro.
 */
const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ["API key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["password", /\b(?:password|passwd|contraseña)\s*[:=]\s*\S{6,}/i],
];

/** El tipo de credencial que parece haber en el texto, o `null`. */
export function findSecret(text: string): string | null {
  for (const [kind, re] of PATTERNS) if (re.test(text)) return kind;
  return null;
}
