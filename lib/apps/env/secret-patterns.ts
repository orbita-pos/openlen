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

export type SecretKind =
  | "stripe"
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
