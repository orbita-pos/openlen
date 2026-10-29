// @vitest-environment node
// The GitHub App (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): its JWT, its installation tokens (one
// per repository, cached), the signed install state and which repository URL gets a token. GitHub is a fake fetch.
import { createVerify, generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appJwt,
  clearGitHubAppCache,
  githubAppConfigured,
  githubRepoOf,
  installationToken,
  signInstallState,
  tokenForRepoUrl,
  userInstallation,
  verifyInstallState,
  type GitHubAppEnv,
} from "./github-app";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const env: GitHubAppEnv = {
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "openlen",
  GITHUB_APP_CLIENT_ID: "Iv23liTEST",
  GITHUB_APP_CLIENT_SECRET: "secret",
  // As it is on the box: the .pem in base64, on one line.
  GITHUB_APP_PRIVATE_KEY: Buffer.from(pem).toString("base64"),
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls: { url: string; init: RequestInit }[];
let answer: (url: string, init: RequestInit) => Response;

beforeEach(() => {
  calls = [];
  clearGitHubAppCache();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v!);
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return answer(url, init);
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const b64urlJson = (s: string) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));

describe("the GitHub App", () => {
  it("is configured only with its five variables", () => {
    expect(githubAppConfigured(env)).toBe(true);
    expect(githubAppConfigured({ ...env, GITHUB_APP_PRIVATE_KEY: "" })).toBe(false);
    expect(githubAppConfigured({})).toBe(false);
  });

  it("🔴 signs a JWT with its key (base64 or PEM) that the public key verifies: iss, iat −60 s, exp +9 min", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    for (const key of [env.GITHUB_APP_PRIVATE_KEY!, pem, pem.replace(/\n/g, "\\n")]) {
      const jwt = appJwt(now, { ...env, GITHUB_APP_PRIVATE_KEY: key });
      const [h, p, s] = jwt.split(".");
      expect(b64urlJson(h!)).toEqual({ alg: "RS256", typ: "JWT" });
      const t = Math.floor(now.getTime() / 1000);
      expect(b64urlJson(p!)).toEqual({ iss: "123456", iat: t - 60, exp: t + 540 });
      const v = createVerify("RSA-SHA256");
      v.update(`${h}.${p}`);
      expect(v.verify(publicKey, Buffer.from(s!.replace(/-/g, "+").replace(/_/g, "/"), "base64"))).toBe(true);
    }
  });

  it("🔴 a token for one repository, cached until 5 minutes before it expires", async () => {
    let n = 0;
    const expires = new Date(Date.now() + 60 * 60_000).toISOString();
    answer = () => json(201, { token: `ghs_${++n}`, expires_at: expires });
    expect(await installationToken(77, "web")).toBe("ghs_1");
    expect(await installationToken(77, "web")).toBe("ghs_1");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.github.com/app/installations/77/access_tokens");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ repositories: ["web"] });
    expect(String((calls[0]!.init.headers as Record<string, string>).Authorization)).toMatch(/^Bearer ey/);
    // Another repository is another token.
    expect(await installationToken(77, "otro")).toBe("ghs_2");
    // One that is about to expire is asked again.
    clearGitHubAppCache();
    answer = () => json(201, { token: `ghs_${++n}`, expires_at: new Date(Date.now() + 4 * 60_000).toISOString() });
    expect(await installationToken(77, "web")).toBe("ghs_3");
    expect(await installationToken(77, "web")).toBe("ghs_4");
  });

  it("a repository the installation doesn't see gets no token", async () => {
    answer = () => json(422, { message: "There is at least one repository that does not exist or is not accessible to the parent installation." });
    expect(await installationToken(77, "ajeno")).toBeNull();
  });

  it("🔴 tokenForRepoUrl: only https://github.com/<owner>/<repo>, only with the installation on that owner", async () => {
    answer = () => json(201, { token: "ghs_x", expires_at: new Date(Date.now() + 3600_000).toISOString() });
    const installations = [{ installationId: 77, accountLogin: "Ana", accountType: "User" as const }];
    expect(await tokenForRepoUrl(installations, "https://github.com/ana/web.git")).toBe("ghs_x");
    expect(await tokenForRepoUrl(installations, "https://github.com/ana/web")).toBe("ghs_x");
    expect(await tokenForRepoUrl(installations, "https://github.com/otra/web.git")).toBeNull();
    expect(await tokenForRepoUrl(installations, "https://gitlab.com/ana/web.git")).toBeNull();
    expect(await tokenForRepoUrl(installations, "https://github.com.evil.io/ana/web.git")).toBeNull();
    expect(await tokenForRepoUrl([], "https://github.com/ana/web.git")).toBeNull();
    expect(calls.every((c) => JSON.parse(String(c.init.body)).repositories[0] === "web")).toBe(true);
  });

  it("githubRepoOf parses what a remote can be", () => {
    expect(githubRepoOf("https://github.com/ana/web.git")).toEqual({ owner: "ana", repo: "web" });
    expect(githubRepoOf("https://github.com/ana/web/")).toEqual({ owner: "ana", repo: "web" });
    expect(githubRepoOf("https://github.com/ana")).toBeNull();
    expect(githubRepoOf("https://github.com/ana/web/tree/main")).toBeNull();
    expect(githubRepoOf("not a url")).toBeNull();
  });

  it("🔴 the install state is signed, bound to the person and short-lived", () => {
    const s = signInstallState({ userId: "u1", projectId: "p1", locale: "es" }, new Date("2026-10-28T12:00:00Z"));
    expect(verifyInstallState(s, new Date("2026-10-28T12:05:00Z"))).toEqual({ userId: "u1", projectId: "p1", locale: "es" });
    expect(verifyInstallState(s, new Date("2026-10-28T12:11:00Z"))).toBeNull();
    expect(verifyInstallState(`${s.slice(0, -2)}xx`, new Date("2026-10-28T12:05:00Z"))).toBeNull();
    expect(verifyInstallState("garbage", new Date())).toBeNull();
  });

  it("🔴 userInstallation: the installation only if the person's own token lists it", async () => {
    answer = (url) =>
      url.startsWith("https://api.github.com/user/installations")
        ? json(200, { total_count: 1, installations: [{ id: 77, account: { login: "ana", type: "User" } }] })
        : json(404, {});
    expect(await userInstallation("ghu_tok", 77)).toEqual({ installationId: 77, accountLogin: "ana", accountType: "User" });
    expect(await userInstallation("ghu_tok", 99)).toBeNull();
    expect(String((calls[0]!.init.headers as Record<string, string>).Authorization)).toBe("Bearer ghu_tok");
  });
});
