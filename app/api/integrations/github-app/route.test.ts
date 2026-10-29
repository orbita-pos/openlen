// @vitest-environment node
// Connecting the GitHub App (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): only the project's owner
// starts it, the callback keeps an installation only if the person's own GitHub token lists it, and the user token
// is used once and dropped. GitHub and the database are doubles.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const d = vi.hoisted(() => ({
  session: vi.fn(),
  owns: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  origin: vi.fn(),
  configured: vi.fn(),
  exchange: vi.fn(),
  userInstallation: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: d.session }));
vi.mock("@/lib/integrations/github-app-store", () => ({
  ownsProject: d.owns,
  saveInstallation: d.save,
  removeInstallations: d.remove,
  installationsOf: d.list,
  originOf: d.origin,
}));
vi.mock("@/lib/integrations/github-app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/github-app")>()),
  githubAppConfigured: d.configured,
  exchangeUserCode: d.exchange,
  userInstallation: d.userInstallation,
}));

import { signInstallState } from "@/lib/integrations/github-app";

import { GET as callback } from "./callback/route";
import { GET as install } from "./install/route";
import { DELETE, GET as status } from "./route";

const req = (url: string, cookie?: string) => new NextRequest(url, cookie ? { headers: { cookie } } : {});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  vi.stubEnv("GITHUB_APP_SLUG", "openlen");
  d.session.mockResolvedValue({ user: { id: "ana" } });
  d.owns.mockResolvedValue(true);
  d.configured.mockReturnValue(true);
  d.list.mockResolvedValue([]);
  d.origin.mockResolvedValue(null);
});

describe("install", () => {
  it("🔴 the owner goes to GitHub's install page with a signed state, also kept in a cookie", async () => {
    const res = await install(req("https://openlen.com/api/integrations/github-app/install?project=p1&locale=es"));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get("location")!);
    expect(`${to.origin}${to.pathname}`).toBe("https://github.com/apps/openlen/installations/new");
    const state = to.searchParams.get("state")!;
    expect(res.cookies.get("ol_github_app_state")?.value).toBe(state);
    expect(res.cookies.get("ol_github_app_state")?.httpOnly).toBe(true);
  });

  it("without a session 401; not the owner 404; without the App 503 github_app_not_configured", async () => {
    d.session.mockResolvedValueOnce(null);
    expect((await install(req("https://openlen.com/api/integrations/github-app/install?project=p1"))).status).toBe(401);
    d.owns.mockResolvedValueOnce(false);
    expect((await install(req("https://openlen.com/api/integrations/github-app/install?project=p1"))).status).toBe(404);
    d.configured.mockReturnValueOnce(false);
    const res = await install(req("https://openlen.com/api/integrations/github-app/install?project=p1"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "github_app_not_configured" });
  });
});

describe("callback", () => {
  const state = () => signInstallState({ userId: "ana", projectId: "p1", locale: "es" });
  const url = (s: string, extra = "&installation_id=77&code=c0de&setup_action=install") => `https://openlen.com/api/integrations/github-app/callback?state=${encodeURIComponent(s)}${extra}`;

  it("🔴 keeps the installation the person's token lists, drops the token and goes back to the project", async () => {
    const s = state();
    d.exchange.mockResolvedValue("ghu_user");
    d.userInstallation.mockResolvedValue({ installationId: 77, accountLogin: "ana", accountType: "User" });
    const res = await callback(req(url(s), `ol_github_app_state=${s}`));
    expect(d.exchange).toHaveBeenCalledWith("c0de");
    expect(d.userInstallation).toHaveBeenCalledWith("ghu_user", 77);
    expect(d.save).toHaveBeenCalledWith("ana", { installationId: 77, accountLogin: "ana", accountType: "User" });
    expect(JSON.stringify(d.save.mock.calls)).not.toContain("ghu_user");
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/es/new");
    expect(to.searchParams.get("project")).toBe("p1");
    expect(to.searchParams.get("github")).toBe("connected");
    expect(res.cookies.get("ol_github_app_state")?.value).toBe("");
  });

  it("🔴 an installation that isn't the person's → 403-like error, no row", async () => {
    const s = state();
    d.exchange.mockResolvedValue("ghu_user");
    d.userInstallation.mockResolvedValue(null);
    const res = await callback(req(url(s), `ol_github_app_state=${s}`));
    expect(res.status).toBe(403);
    expect(d.save).not.toHaveBeenCalled();
  });

  it("🔴 a state without its cookie, of someone else or forged → refused, nothing exchanged", async () => {
    const s = state();
    expect((await callback(req(url(s)))).status).toBe(400);
    d.session.mockResolvedValueOnce({ user: { id: "eva" } });
    expect((await callback(req(url(s), `ol_github_app_state=${s}`))).status).toBe(400);
    expect((await callback(req(url("x.y"), "ol_github_app_state=x.y"))).status).toBe(400);
    expect(d.exchange).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  it("no code (the person cancelled) → back to the project saying so", async () => {
    const s = state();
    const res = await callback(req(url(s, "&installation_id=77"), `ol_github_app_state=${s}`));
    expect(new URL(res.headers.get("location")!).searchParams.get("github_error")).toBe("denied");
    expect(d.save).not.toHaveBeenCalled();
  });
});

describe("status and disconnect", () => {
  it("says whether the App is there, the accounts and the project's origin; no token anywhere", async () => {
    d.list.mockResolvedValue([{ installationId: 77, accountLogin: "ana", accountType: "User" }]);
    d.origin.mockResolvedValue("https://github.com/ana/web.git");
    const res = await status(req("https://openlen.com/api/integrations/github-app?project=p1"));
    expect(await res.json()).toEqual({ configured: true, accounts: [{ login: "ana", type: "User" }], origin: "https://github.com/ana/web.git" });
  });

  it("only the owner; disconnect forgets the installations", async () => {
    d.owns.mockResolvedValue(false);
    expect((await status(req("https://openlen.com/api/integrations/github-app?project=p1"))).status).toBe(404);
    expect((await DELETE(req("https://openlen.com/api/integrations/github-app?project=p1"))).status).toBe(404);
    expect(d.remove).not.toHaveBeenCalled();
    d.owns.mockResolvedValue(true);
    expect((await DELETE(req("https://openlen.com/api/integrations/github-app?project=p1"))).status).toBe(204);
    expect(d.remove).toHaveBeenCalledWith("ana");
  });
});
