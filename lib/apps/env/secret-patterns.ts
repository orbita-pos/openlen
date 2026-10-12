// ¿PARECE UN SECRETO? (spec local
// docs/superpowers/specs/2026-10-10-variables-de-entorno-design.md)
//
// Todo lo que llega a `import.meta.env` acaba en el JavaScript que lee cualquier
// visitante. Esto marca lo que con seguridad NO debería ir ahí: claves secretas
// con un formato conocido, y nombres que dicen serlo. Las PUBLICABLES
// (`pk_live_`, el `pk.` de Mapbox, `AIza…` de Google, `phc_` de PostHog,
// `sb_publishable_`, el JWT `anon` de Supabase) NO se marcan: son justo para lo
// que existen las variables. Sin dependencias: lo importan el diálogo, la ruta y
// la carpeta.
// Desde las Edge Functions también la tarjeta de secretos y el compositor del chat.

export type SecretKind =
  | "stripe"
  | "mercadopago"
  | "anthropic"
  | "openai"
  | "github"
  | "aws"
  | "slack"
  | "sendgrid"
  | "google_oauth"
  | "supabase_secret"
  | "supabase_service_role"
  | "private_key"
  | "secret_name";

export type ProviderSecretKind = Exclude<SecretKind, "private_key" | "secret_name">;

/** El nombre del servicio como se escribe en cualquier idioma: no se traduce. */
export const SECRET_PROVIDER: Readonly<Record<ProviderSecretKind, string>> = {
  stripe: "Stripe",
  mercadopago: "Mercado Pago",
  anthropic: "Anthropic",
  openai: "OpenAI",
  github: "GitHub",
  aws: "AWS",
  slack: "Slack",
  sendgrid: "SendGrid",
  google_oauth: "Google",
  supabase_secret: "Supabase",
  supabase_service_role: "Supabase",
};

// El orden importa: `sk-ant-` también casaría con la de OpenAI.
const BY_VALUE: ReadonlyArray<readonly [ProviderSecretKind, RegExp]> = [
  ["stripe", /^(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}$/],
  ["stripe", /^whsec_[A-Za-z0-9]{10,}$/],
  // El access token de Mercado Pago (`APP_USR-…` real, `TEST-…` de prueba):
  // cifras-cifras-32 hex-cifras. Su clave PÚBLICA es `APP_USR-<uuid>` y no casa.
  ["mercadopago", /^(?:APP_USR|TEST)-\d{10,20}-\d{6}-[0-9a-f]{32}-\d{6,12}$/],
  ["anthropic", /^sk-ant-[A-Za-z0-9_-]{10,}$/],
  ["openai", /^sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}$/],
  ["github", /^(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/],
  ["aws", /^(?:AKIA|ASIA)[0-9A-Z]{16}$/],
  ["slack", /^xox[abprs]-[A-Za-z0-9-]{10,}$/],
  ["sendgrid", /^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/],
  ["google_oauth", /^GOCSPX-[A-Za-z0-9_-]{10,}$/],
  ["supabase_secret", /^sb_secret_[A-Za-z0-9_-]{10,}$/],
];

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SECRET_NAME = /SECRET|PRIVATE_KEY|SERVICE_ROLE/i;
const JWT = /^eyJ[A-Za-z0-9_-]*\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]*$/;

/** El `role` que dice tener un JWT (sin verificar la firma: sólo se mira qué dice ser), o `null`. */
function jwtRole(token: string): unknown {
  const m = JWT.exec(token);
  if (!m) return null;
  const payload = m[1]!;
  try {
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    return (JSON.parse(atob(b64)) as { role?: unknown }).role ?? null;
  } catch {
    return null;
  }
}

/** Qué clase de secreto parece `value` (o lo que dice `name`), o `null` si nada lo delata. */
export function detectSecret(name: string, value: string): SecretKind | null {
  const v = value.trim();
  for (const [kind, re] of BY_VALUE) if (re.test(v)) return kind;
  if (PRIVATE_KEY.test(v)) return "private_key";
  if (jwtRole(v) === "service_role") return "supabase_service_role";
  if (SECRET_NAME.test(name)) return "secret_name";
  return null;
}

/** Cómo se lo dice a Len el rechazo de `/.env` («VITE_X looks like a Stripe secret key»). */
export function describeSecretForModel(kind: SecretKind): string {
  if (kind === "secret_name") return "is named as a secret";
  if (kind === "private_key") return "holds a private key";
  return `looks like a ${SECRET_PROVIDER[kind]} secret key`;
}

// ─── Edge Functions (spec local 2026-10-11, Parte 4) ─────────────────────────
// Los secretos de las funciones SÍ son para claves secretas: aquí no se rechaza
// nada. Se avisa de cruzar prueba y real, y el compositor del chat busca una
// clave dentro de lo que el dueño va a mandarle a Len.

/** ¿De PRUEBA o REAL? Sólo las claves que lo dicen en su forma. */
export type SecretMode = "test" | "live";

const MODES: ReadonlyArray<readonly [RegExp, SecretMode]> = [
  [/^(?:sk|rk)_live_[A-Za-z0-9]{10,}$/, "live"],
  [/^(?:sk|rk)_test_[A-Za-z0-9]{10,}$/, "test"],
  [/^APP_USR-\d{10,20}-\d{6}-[0-9a-f]{32}-\d{6,12}$/, "live"],
  [/^TEST-\d{10,20}-\d{6}-[0-9a-f]{32}-\d{6,12}$/, "test"],
];

export function secretMode(value: string): SecretMode | null {
  const v = value.trim();
  for (const [re, mode] of MODES) if (re.test(v)) return mode;
  return null;
}

export type SecretModeWarning = "live_in_draft" | "test_in_live";

/** Una clave REAL en el borrador (los pagos de prueba serían de verdad) o una
 *  de PRUEBA en producción (la publicada no cobraría). Avisa; no impide. */
export function secretModeWarning(environment: "draft" | "live", value: string): SecretModeWarning | null {
  const mode = secretMode(value);
  if (mode === "live" && environment === "draft") return "live_in_draft";
  if (mode === "test" && environment === "live") return "test_in_live";
  return null;
}

export interface FoundSecret {
  readonly value: string;
  readonly kind: ProviderSecretKind | "private_key";
  /** Dónde está en el texto: `texto.slice(start, end) === value`. */
  readonly start: number;
  readonly end: number;
}

// Un trozo sin espacios ni comillas ni paréntesis; el punto final de una frase
// se quita después (los JWT y SendGrid llevan puntos DENTRO).
const TOKEN = /[^\s"'`<>()[\]{},;]+/g;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const TRAILING = /[.:!?]+$/;

/** Lo que tiene pinta de secreto DENTRO de un texto (el compositor del chat):
 *  cada trozo que, solo, delataría una clave con formato conocido, y los
 *  bloques de clave privada. Sin nombres (`secret_name` necesita uno). En orden. */
export function findSecretsInText(text: string): FoundSecret[] {
  const out: FoundSecret[] = [];
  for (const m of text.matchAll(PRIVATE_KEY_BLOCK)) {
    out.push({ value: m[0], kind: "private_key", start: m.index!, end: m.index! + m[0].length });
  }
  for (const m of text.matchAll(TOKEN)) {
    const start = m.index!;
    if (out.some((f) => start >= f.start && start < f.end)) continue;
    const value = m[0].replace(TRAILING, "");
    const kind = detectSecret("", value);
    if (kind && kind !== "secret_name" && kind !== "private_key") out.push({ value, kind, start, end: start + value.length });
  }
  return out.sort((a, b) => a.start - b.start);
}

const SUGGESTED_NAME: Partial<Record<ProviderSecretKind, string>> = {
  mercadopago: "MERCADOPAGO_ACCESS_TOKEN",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  github: "GITHUB_TOKEN",
  slack: "SLACK_TOKEN",
  sendgrid: "SENDGRID_API_KEY",
  google_oauth: "GOOGLE_CLIENT_SECRET",
};

/** El nombre que la tarjeta propone (el de los ejemplos de Supabase); "" si no
 *  hay uno obvio — AWS_ y SUPABASE_ no se pueden usar como nombre. */
export function suggestSecretName(found: Pick<FoundSecret, "kind" | "value">): string {
  if (found.kind === "stripe") return found.value.trim().startsWith("whsec_") ? "STRIPE_WEBHOOK_SECRET" : "STRIPE_SECRET_KEY";
  if (found.kind === "private_key") return "";
  return SUGGESTED_NAME[found.kind] ?? "";
}
