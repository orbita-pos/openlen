// @vitest-environment node
//
// The `github` source (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.5): the connected repository's
// issues, pull requests and failed CI checks, read with the owner's installation token. Polled — the App has no
// webhook. GitHub's API is a fake fetch, as in lib/gh/run.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { githubApi } from "@/lib/gh/rest";

vi.mock("server-only", () => ({}));

const { githubSourceWith } = await import("./github");

type Handler = (body: unknown, url: URL) => { status: number; body?: unknown; headers?: Record<string, string> };
let routes: Record<string, Handler>;
let calls: { method: string; path: string; auth: string | null; body: unknown }[];
const json = (status: number, body?: unknown, headers?: Record<string, string>) => ({ status, body, ...(headers ? { headers } : {}) });
beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
    calls.push({ method, path: `${url.pathname}${url.search}`, auth, body });
    const h = routes[`${method} ${url.pathname}`];
    const r = h ? h(body, url) : { status: 404, body: { message: "Not Found" } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  });
});
afterEach(() => vi.unstubAllGlobals());

const CTX = { timeZone: "UTC", now: new Date("2026-11-04T10:00:00Z"), ownerId: "owner" };
const OLD = "2026-10-01T00:00:00Z";
const connected = { ok: true as const, owner: "ana", repo: "web", token: "ghs_x" };
let repoOf: ReturnType<typeof vi.fn>;
const source = () => githubSourceWith({ repoOf: repoOf as never, api: githubApi, appLogin: () => "openlen[bot]" });

const issue = (n: number, o: { created: string; updated: string; closed?: string; pr?: boolean }) => ({
  number: n,
  title: `Issue ${n}`,
  state: o.closed ? "closed" : "open",
  user: { login: "luis" },
  labels: [{ name: "bug" }],
  body: "Se cae el login",
  html_url: `https://github.com/ana/web/issues/${n}`,
  created_at: o.created,
  updated_at: o.updated,
  closed_at: o.closed ?? null,
  ...(o.pr ? { pull_request: {} } : {}),
});

beforeEach(() => {
  repoOf = vi.fn(async () => connected);
  Object.assign(routes, {
    "GET /repos/ana/web": () => json(200, { default_branch: "main" }),
    "GET /repos/ana/web/branches/main": () => json(200, { commit: { sha: "sha-main" } }),
    "GET /repos/ana/web/pulls": () => json(200, []),
    "GET /repos/ana/web/commits/sha-main/check-runs": () => json(200, { check_runs: [] }),
    "GET /repos/ana/web/issues": () => json(200, []),
  });
});

async function started() {
  const v = await source().validate("p1", {}, CTX);
  if (!v.ok) throw new Error(v.reason);
  return v.initialState;
}

describe("github", () => {
  it("a new issue is an opened change; an old one commented is updated with its new comments", async () => {
    const state = await started();
    routes["GET /repos/ana/web/issues"] = () => json(200, [issue(3, { created: "2026-11-04T10:05:00Z", updated: "2026-11-04T10:05:00Z" }), issue(1, { created: OLD, updated: "2026-11-04T10:06:00Z" })]);
    routes["GET /repos/ana/web/issues/1/comments"] = () => json(200, [{ user: { login: "eva", type: "User" }, body: "A mí también", created_at: "2026-11-04T10:06:00Z" }]);
    const o = await source().observe("p1", {}, state, CTX);
    expect(o.changes.map((c) => [c.subject, c.link, c.detail.action])).toEqual([
      ["issue", "3", "opened"],
      ["issue", "1", "updated"],
    ]);
    expect(o.changes[0]!.detail).toMatchObject({ kind: "issue", number: 3, title: "Issue 3", author: "luis", labels: "bug", url: "https://github.com/ana/web/issues/3" });
    expect(o.changes[1]!.detail.new_comments).toEqual([{ author: "eva", body: "A mí también", at: "2026-11-04T10:06:00Z" }]);
    expect(o.state.cursor).toBe("2026-11-04T10:06:00Z");
    expect(calls.every((c) => c.auth === "Bearer ghs_x")).toBe(true);
  });

  it("an issue whose only new comments are the OpenLen app's is not a change", async () => {
    const state = await started();
    routes["GET /repos/ana/web/issues"] = () => json(200, [issue(1, { created: OLD, updated: "2026-11-04T10:06:00Z" })]);
    routes["GET /repos/ana/web/issues/1/comments"] = () => json(200, [{ user: { login: "openlen[bot]", type: "Bot" }, body: "Lo miramos.\n\n<!-- openlen-card:c1 -->", created_at: "2026-11-04T10:06:00Z" }]);
    const o = await source().observe("p1", {}, state, CTX);
    expect(o.changes).toEqual([]);
    expect(o.state.cursor).toBe("2026-11-04T10:06:00Z");
  });

  it("a failed check on the default branch or an open pull request is a ci change, once", async () => {
    const state = await started();
    routes["GET /repos/ana/web/pulls"] = () => json(200, [{ number: 7, title: "Nuevo menú", head: { sha: "sha-7", ref: "menu" } }]);
    routes["GET /repos/ana/web/commits/sha-main/check-runs"] = () =>
      json(200, {
        check_runs: [
          { id: 501, name: "build", conclusion: "failure", completed_at: "2026-11-04T10:07:00Z", html_url: "https://github.com/ana/web/runs/501" },
          { id: 502, name: "lint", conclusion: "success", completed_at: "2026-11-04T10:07:00Z", html_url: "x" },
        ],
      });
    routes["GET /repos/ana/web/commits/sha-7/check-runs"] = () => json(200, { check_runs: [{ id: 601, name: "test", conclusion: "timed_out", completed_at: "2026-11-04T10:08:00Z", html_url: "y" }] });
    const o = await source().observe("p1", {}, state, CTX);
    expect(o.changes.map((c) => [c.subject, c.link])).toEqual([
      ["ci", "501"],
      ["ci", "601"],
    ]);
    expect(o.changes[0]!.detail).toMatchObject({ kind: "ci", action: "failed", number: null, branch: "main", check: "build", conclusion: "failure" });
    expect(o.changes[1]!.detail).toMatchObject({ number: 7, title: "Nuevo menú", branch: "menu", check: "test", conclusion: "timed_out" });
    expect((await source().observe("p1", {}, o.state, CTX)).changes).toEqual([]);
  });

  it("what exists when the task is made never fires", async () => {
    routes["GET /repos/ana/web/issues"] = () => json(200, [issue(1, { created: OLD, updated: "2026-11-04T09:00:00Z" })]);
    routes["GET /repos/ana/web/commits/sha-main/check-runs"] = () => json(200, { check_runs: [{ id: 9, name: "build", conclusion: "failure", completed_at: "2026-11-04T09:30:00Z", html_url: "z" }] });
    const state = await started();
    expect((await source().observe("p1", {}, state, CTX)).changes).toEqual([]);
  });

  it("twenty-one issues with one updated_at are not cut in half", async () => {
    const state = await started();
    const at = "2026-11-04T10:05:00Z";
    const later = "2026-11-04T10:06:00Z";
    routes["GET /repos/ana/web/issues"] = () =>
      json(200, [...Array.from({ length: 21 }, (_, i) => issue(i + 1, { created: at, updated: at })), ...Array.from({ length: 4 }, (_, i) => issue(100 + i, { created: later, updated: later }))]);
    const first = await source().observe("p1", {}, state, CTX);
    expect(first.changes).toHaveLength(21);
    expect(first.state.cursor).toBe(at);
    const second = await source().observe("p1", {}, first.state, CTX);
    expect(second.changes.map((c) => c.link)).toEqual(["100", "101", "102", "103"]);
  });

  it("a spent rate limit is a failed record, and the next check continues", async () => {
    const state = await started();
    routes["GET /repos/ana/web/issues"] = () => json(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" });
    await expect(source().observe("p1", {}, state, CTX)).rejects.toMatchObject({ reason: "rate_limited" });
    routes["GET /repos/ana/web/issues"] = () => json(200, [issue(3, { created: "2026-11-04T10:05:00Z", updated: "2026-11-04T10:05:00Z" })]);
    expect((await source().observe("p1", {}, state, CTX)).changes.map((c) => c.link)).toEqual(["3"]);
  });

  it("an uninstalled app is github_unavailable, and a task can't be made without it", async () => {
    const state = await started();
    repoOf.mockResolvedValue({ ok: false, reason: "not_connected" });
    await expect(source().observe("p1", {}, state, CTX)).rejects.toMatchObject({ reason: "github_unavailable" });
    expect(await source().validate("p1", {}, CTX)).toEqual({ ok: false, reason: expect.stringContaining("isn't installed") });
    repoOf.mockResolvedValue({ ok: false, reason: "no_remote" });
    expect(await source().validate("p1", {}, CTX)).toEqual({ ok: false, reason: expect.stringContaining("Connect GitHub") });
  });

  it("read gives an issue with its comments and the latest updated; match by label; another field is refused", async () => {
    const state = await started();
    routes["GET /repos/ana/web/issues/3"] = () => json(200, issue(3, { created: OLD, updated: OLD }));
    routes["GET /repos/ana/web/issues/3/comments"] = () => json(200, [{ user: { login: "eva" }, body: "Me pasa en el móvil", created_at: OLD }]);
    routes["GET /repos/ana/web/issues"] = () => json(200, [issue(5, { created: OLD, updated: OLD, pr: true })]);
    const read = (await source().read("p1", {}, { keys: ["3"], state, ctx: CTX })) as { items: Record<string, unknown>[]; previous: Record<string, unknown>[] };
    expect(read.items).toEqual([expect.objectContaining({ number: 3, title: "Issue 3", kind: "issue", comments: [{ author: "eva", body: "Me pasa en el móvil", at: OLD }] })]);
    expect(read.previous).toEqual([expect.objectContaining({ number: 5, kind: "pull_request" })]);
    const matched = (await source().read("p1", {}, { keys: [], state, match: [{ field: "label", value: "bug" }], ctx: CTX })) as { matching: unknown[] };
    expect(matched.matching).toHaveLength(1);
    expect(calls.some((c) => c.path.includes("labels=bug"))).toBe(true);
    await expect(source().read("p1", {}, { keys: [], state, match: [{ field: "title", value: "x" }], ctx: CTX })).rejects.toMatchObject({ reason: "column_missing" });
  });
});
