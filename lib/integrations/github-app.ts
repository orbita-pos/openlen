// OpenLen's GitHub App (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): how the owner connects GitHub and
// how the server gets the token git and `gh` use. Like Bolt and v0, an App and not OAuth: it sees private repositories
// and only the ones the person chose. The token is the installation's, asked per repository (it can touch nothing
// else), lasts an hour, is cached in memory and is never stored, never sent to the box and never shown to Len.
// Plain fetch, no @octokit, like the deploy drivers beside it.
import { createHmac, createSign, randomBytes, timingSafeEqual } from "node:crypto";

export const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";
const USER_AGENT = "OpenLen";

/** GITHUB_APP_ID, _SLUG, _PRIVATE_KEY, _CLIENT_ID and _CLIENT_SECRET: process.env, or a test's. */
export type GitHubAppEnv = Readonly<Record<string, string | undefined>>;

/** One installation of the App that a person connected: their account or an organization of theirs. */
export interface GitHubInstallation {
  readonly installationId: number;
  readonly accountLogin: string;
  readonly accountType: "User" | "Organization";
}

const value = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);

export function githubAppConfigured(env: GitHubAppEnv = process.env): boolean {
  return Boolean(
    value(env.GITHUB_APP_ID) &&
      value(env.GITHUB_APP_SLUG) &&
      value(env.GITHUB_APP_PRIVATE_KEY) &&
      value(env.GITHUB_APP_CLIENT_ID) &&
      value(env.GITHUB_APP_CLIENT_SECRET),
  );
}

/** The .pem as the box keeps it: base64 on one line (an env file has no multi-line values), or the PEM itself. */
function privateKeyPem(env: GitHubAppEnv): string {
  const raw = value(env.GITHUB_APP_PRIVATE_KEY);
  if (!raw) throw new Error("GITHUB_APP_PRIVATE_KEY is not set");
  if (raw.includes("-----BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw, "base64").toString("utf8");
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The App's own JWT (RS256): GitHub's recipe, issued 60 s in the past for clock drift, valid 9 of its 10 minutes. */
export function appJwt(now: Date, env: GitHubAppEnv = process.env): string {
  const t = Math.floor(now.getTime() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ iss: value(env.GITHUB_APP_ID), iat: t - 60, exp: t + 540 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${b64url(signer.sign(privateKeyPem(env)))}`;
}

function headers(bearer: string): Record<string, string> {
  return { Authorization: `Bearer ${bearer}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, "User-Agent": USER_AGENT };
}

// Installation tokens by installation and repository; dropped 5 minutes before they expire.
const tokens = new Map<string, { readonly token: string; readonly expiresAt: number }>();
const MARGIN_MS = 5 * 60_000;

export function clearGitHubAppCache(): void {
  tokens.clear();
}

/**
 * An installation token, for one repository when `repo` is given (GitHub refuses with 422 if the installation can't see
 * it: null) or for the whole installation (to create a repository). null when GitHub won't give one.
 */
export async function installationToken(installationId: number, repo?: string): Promise<string | null> {
  const key = `${installationId}:${repo ?? "*"}`;
  const hit = tokens.get(key);
  if (hit && hit.expiresAt - MARGIN_MS > Date.now()) return hit.token;
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { ...headers(appJwt(new Date())), "Content-Type": "application/json" },
    body: JSON.stringify(repo ? { repositories: [repo] } : {}),
  });
  if (!res.ok) {
    if (res.status !== 404 && res.status !== 422) console.warn(`[github-app] installation token: HTTP ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { token?: string; expires_at?: string };
  if (!body.token) return null;
  tokens.set(key, { token: body.token, expiresAt: body.expires_at ? Date.parse(body.expires_at) : Date.now() + 3600_000 });
  return body.token;
}

/** `https://github.com/<owner>/<repo>(.git)` → its owner and name; anything else → null. */
export function githubRepoOf(url: string): { owner: string; repo: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.hostname !== "github.com" || u.username || u.password) return null;
  const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const repo = parts[1]!.replace(/\.git$/, "");
  return repo ? { owner: parts[0]!, repo } : null;
}

/** The token for a remote's URL: only a github.com repository of an account the person installed the App on. */
export async function tokenForRepoUrl(installations: readonly GitHubInstallation[], url: string): Promise<string | null> {
  const r = githubRepoOf(url);
  if (!r) return null;
  const inst = installations.find((i) => i.accountLogin.toLowerCase() === r.owner.toLowerCase());
  return inst ? installationToken(inst.installationId, r.repo) : null;
}

// ── Installing ───────────────────────────────────────────────────────────────

export function installUrl(state: string, env: GitHubAppEnv = process.env): string {
  return `https://github.com/apps/${encodeURIComponent(value(env.GITHUB_APP_SLUG) ?? "")}/installations/new?state=${encodeURIComponent(state)}`;
}

export interface InstallState {
  readonly userId: string;
  readonly projectId: string;
  readonly locale: string;
}

const STATE_TTL_MS = 10 * 60_000;
/** The cookie that carries the same state, so the callback knows the round trip began in this browser. */
export const INSTALL_STATE_COOKIE = "ol_github_app_state";

function stateSecret(): string {
  const s = value(process.env.NEXTAUTH_SECRET) ?? value(process.env.AUTH_SECRET);
  if (!s) throw new Error("NEXTAUTH_SECRET is required to sign the GitHub install state");
  return `github-app:${s}`;
}

/** The round trip's state: who started it, from which project, signed, and valid ten minutes. */
export function signInstallState(p: InstallState, now: Date = new Date()): string {
  const body = b64url(JSON.stringify({ ...p, at: now.getTime(), nonce: randomBytes(8).toString("hex") }));
  return `${body}.${b64url(createHmac("sha256", stateSecret()).update(body).digest())}`;
}

export function verifyInstallState(token: string, now: Date = new Date()): InstallState | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(b64url(createHmac("sha256", stateSecret()).update(body).digest()));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as InstallState & { at: number };
    if (typeof p.userId !== "string" || typeof p.projectId !== "string" || typeof p.locale !== "string") return null;
    if (!(now.getTime() - p.at >= 0 && now.getTime() - p.at <= STATE_TTL_MS)) return null;
    return { userId: p.userId, projectId: p.projectId, locale: p.locale };
  } catch {
    return null;
  }
}

/** The installing person's user token, from the code GitHub sends back. Used once to check the installation is theirs. */
export async function exchangeUserCode(code: string, env: GitHubAppEnv = process.env): Promise<string | null> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: value(env.GITHUB_APP_CLIENT_ID), client_secret: value(env.GITHUB_APP_CLIENT_SECRET), code }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { access_token?: string };
  return body.access_token ?? null;
}

/** The installation, only if the person's own token lists it among theirs (an installation id in a URL proves nothing). */
export async function userInstallation(userToken: string, installationId: number): Promise<GitHubInstallation | null> {
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${GITHUB_API}/user/installations?per_page=100&page=${page}`, { headers: headers(userToken) });
    if (!res.ok) return null;
    const body = (await res.json()) as { installations?: { id: number; account?: { login?: string; type?: string } }[] };
    const list = body.installations ?? [];
    const found = list.find((i) => i.id === installationId);
    if (found?.account?.login) {
      if (found.account.type !== "Organization") return { installationId, accountLogin: found.account.login, accountType: "User" };
      // An organization's installation is listed to its members too; OpenLen pushes with the App's write access, so
      // only an admin of the organization may connect it — a member would get more than their role on GitHub.
      const m = await fetch(`${GITHUB_API}/user/memberships/orgs/${encodeURIComponent(found.account.login)}`, { headers: headers(userToken) });
      const membership = m.ok ? ((await m.json()) as { state?: string; role?: string }) : null;
      return membership?.state === "active" && membership.role === "admin" ? { installationId, accountLogin: found.account.login, accountType: "Organization" } : null;
    }
    if (list.length < 100) return null;
  }
  return null;
}
