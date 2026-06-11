import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Shared OAuth mechanics for the external-deploy connections (Vercel + GitHub).
//
// Both use a classic authorization-code flow that yields a LONG-LIVED access
// token (GitHub OAuth-App tokens don't expire; Vercel connectable-integration
// tokens are long-lived), so there is no refresh-rotation here. The token is an
// account-level credential stored once per user (see lib/integrations/index.ts).
//
// CSRF: signState() HMACs {projectId, provider, locale, nonce} with
// NEXTAUTH_SECRET; the start route stores it in an httpOnly cookie and the
// callback re-verifies both the signature and the cookie match.
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = "vercel" | "github";

export function isProvider(x: string): x is Provider {
  return x === "vercel" || x === "github";
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  vercel: "Vercel",
  github: "GitHub",
};

/** Carries a user-safe message + an HTTP status the routes map onto responses. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: Provider,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

function secret(): string {
  const s = env("NEXTAUTH_SECRET") || env("AUTH_SECRET");
  if (!s) throw new Error("NEXTAUTH_SECRET is required for OAuth state signing.");
  return s;
}

/** True once the operator has configured the provider's OAuth client. */
export function providerConfigured(provider: Provider): boolean {
  if (provider === "github") {
    return !!(env("GITHUB_DEPLOY_CLIENT_ID") && env("GITHUB_DEPLOY_CLIENT_SECRET"));
  }
  return !!(
    env("VERCEL_CLIENT_ID") &&
    env("VERCEL_CLIENT_SECRET") &&
    env("VERCEL_INTEGRATION_SLUG")
  );
}

// Canonical public origin for OAuth redirect URIs + the post-OAuth redirects
// back into the workspace. Derived from configured env (never request headers,
// to avoid Host spoofing). In production we pin to the locked domain and ignore
// a localhost value leaking from a misconfigured env / proxy, so nothing ever
// bounces the user to localhost behind the openlen-edge proxy.
export function publicOrigin(): string {
  if (process.env.NODE_ENV === "production") {
    const e = env("NEXTAUTH_URL") || env("APP_BASE_URL");
    if (e && !/localhost|127\.0\.0\.1/.test(e)) return e.replace(/\/+$/, "");
    return "https://openlen.com";
  }
  return (
    env("NEXTAUTH_URL") || env("APP_BASE_URL") || "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export function redirectUri(provider: Provider): string {
  return `${publicOrigin()}/api/integrations/${provider}/callback`;
}

// ── Signed state (CSRF) ──────────────────────────────────────────────────────

export interface StatePayload {
  projectId: string;
  provider: Provider;
  locale: string;
  /** Site page the workspace was showing (?page=) — restored on return so
   *  the round-trip lands the user back on the same document. */
  page?: string;
  nonce: string;
}

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function signState(payload: Omit<StatePayload, "nonce">): string {
  const full: StatePayload = { ...payload, nonce: randomBytes(12).toString("hex") };
  const body = b64url(Buffer.from(JSON.stringify(full), "utf8"));
  const mac = b64url(createHmac("sha256", secret()).update(body).digest());
  return `${body}.${mac}`;
}

export function verifyState(token: string): StatePayload | null {
  const dot = token.indexOf(".");
  if (dot === -1) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = b64url(createHmac("sha256", secret()).update(body).digest());
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const json = Buffer.from(
      body.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const parsed = JSON.parse(json) as StatePayload;
    if (!parsed.projectId || !isProvider(parsed.provider)) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Authorize URL ────────────────────────────────────────────────────────────

export function authorizeUrl(provider: Provider, state: string): string {
  if (provider === "github") {
    const u = new URL("https://github.com/login/oauth/authorize");
    u.searchParams.set("client_id", env("GITHUB_DEPLOY_CLIENT_ID") ?? "");
    u.searchParams.set("redirect_uri", redirectUri("github"));
    // public_repo is enough to create public repos + commit + enable Pages on
    // a repo the user owns. If GitHub ever rejects the Pages step for scope,
    // widen this to "repo".
    u.searchParams.set("scope", "public_repo");
    u.searchParams.set("state", state);
    return u.toString();
  }
  // Vercel connectable-account integration install link. The redirect URL is
  // fixed in the integration config; Vercel forwards `state` back to it.
  const slug = env("VERCEL_INTEGRATION_SLUG") ?? "";
  const u = new URL(`https://vercel.com/integrations/${slug}/new`);
  u.searchParams.set("state", state);
  return u.toString();
}

// ── Code → token + account identity ──────────────────────────────────────────

export interface ConnectionTokens {
  accessToken: string;
  refreshToken: string | null;
  accountLabel: string | null;
  teamId: string | null;
  scope: string | null;
}

export async function exchangeCodeAndFetchAccount(
  provider: Provider,
  code: string,
): Promise<ConnectionTokens> {
  return provider === "github" ? githubExchange(code) : vercelExchange(code);
}

async function githubExchange(code: string): Promise<ConnectionTokens> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: env("GITHUB_DEPLOY_CLIENT_ID") ?? "",
      client_secret: env("GITHUB_DEPLOY_CLIENT_SECRET") ?? "",
      code,
      redirect_uri: redirectUri("github"),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new ProviderError(
      "github",
      data.error_description || data.error || "GitHub authorization failed.",
      502,
    );
  }
  let accountLabel: string | null = null;
  try {
    const u = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${data.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "OpenLen-Deploy",
      },
    });
    if (u.ok) {
      const j = (await u.json()) as { login?: string };
      accountLabel = j.login ?? null;
    }
  } catch {
    /* best-effort label */
  }
  return {
    accessToken: data.access_token,
    refreshToken: null,
    accountLabel,
    teamId: null,
    scope: data.scope ?? null,
  };
}

async function vercelExchange(code: string): Promise<ConnectionTokens> {
  const res = await fetch("https://api.vercel.com/v2/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("VERCEL_CLIENT_ID") ?? "",
      client_secret: env("VERCEL_CLIENT_SECRET") ?? "",
      code,
      redirect_uri: redirectUri("vercel"),
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    team_id?: string | null;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    throw new ProviderError(
      "vercel",
      data.error_description || data.error || "Vercel authorization failed.",
      502,
    );
  }
  const teamId = data.team_id ?? null;
  let accountLabel: string | null = null;
  try {
    const u = await fetch("https://api.vercel.com/v2/user", {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (u.ok) {
      const j = (await u.json()) as {
        user?: { username?: string; name?: string };
      };
      accountLabel = j.user?.username ?? j.user?.name ?? null;
    }
  } catch {
    /* best-effort label */
  }
  return {
    accessToken: data.access_token,
    refreshToken: null,
    accountLabel,
    teamId,
    scope: null,
  };
}
