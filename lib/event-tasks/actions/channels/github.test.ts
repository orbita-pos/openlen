// @vitest-environment node
//
// The owner's reply on GitHub (spec local 2026-11-04-hazlo, §7.4.5, §7.6.3): a comment by the OpenLen GitHub app on an
// issue or pull request, once per card. GitHub has no idempotency key, so the comment carries an invisible marker, and
// a retry looks for it before posting again — DeepSeek's check before repeating an outside action.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { githubApi } from "@/lib/gh/rest";

import type { EventTaskCardRow } from "../../store";

vi.mock("server-only", () => ({}));

const { githubSender, markerOf } = await import("./github");

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

const NOW = new Date("2026-11-04T10:05:00Z");
const card = { id: "c1", projectId: "p1", decidedAt: new Date("2026-11-04T10:00:00Z") } as EventTaskCardRow;
const reply = { kind: "reply" as const, channel: "github" as const, to: "12", toLabel: "#12 Login roto", body: "Lo miramos hoy." };
let repoOf: ReturnType<typeof vi.fn>;
let pinnedOf: ReturnType<typeof vi.fn>;
beforeEach(() => {
  repoOf = vi.fn(async () => ({ ok: true, owner: "ana", repo: "web", token: "ghs_x" }));
  pinnedOf = vi.fn(async () => ({ owner: "ana", repo: "web" }));
  routes["GET /repos/ana/web/issues/12/comments"] = () => json(200, []);
});
const send = () => githubSender({ repoOf: repoOf as never, pinnedOf: pinnedOf as never, ownerOf: async () => "owner", api: githubApi });
const posts = () => calls.filter((c) => c.method === "POST");

describe("githubSender", () => {
  it("the comment carries the card's hidden marker", async () => {
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(201, { id: 1 });
    expect(await send()(card, reply, 1, NOW)).toEqual({ kind: "sent", result: "#12" });
    expect(posts()).toEqual([expect.objectContaining({ path: "/repos/ana/web/issues/12/comments", auth: "Bearer ghs_x", body: { body: `Lo miramos hoy.\n\n${markerOf("c1")}` } })]);
    expect(markerOf("c1")).toBe("<!-- openlen-card:c1 -->");
  });

  it("a retry finds the comment already posted and doesn't post again", async () => {
    routes["GET /repos/ana/web/issues/12/comments"] = () => json(200, [{ id: 1, body: `Lo miramos hoy.\n\n${markerOf("c1")}` }]);
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(201, { id: 2 });
    expect(await send()(card, reply, 2, NOW)).toEqual({ kind: "sent", result: "#12" });
    expect(posts()).toEqual([]);
    expect(calls[0]!.path).toContain("since=2026-11-04T10%3A00%3A00.000Z");
  });

  it("a retry that finds nothing posts", async () => {
    routes["GET /repos/ana/web/issues/12/comments"] = () => json(200, [{ id: 1, body: "otra cosa" }]);
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(201, { id: 2 });
    expect(await send()(card, reply, 2, NOW)).toEqual({ kind: "sent", result: "#12" });
    expect(posts()).toHaveLength(1);
  });

  it("a 404 is final, a 502 is tried again", async () => {
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(404, { message: "Not Found" });
    expect(await send()(card, reply, 1, NOW)).toEqual({ kind: "failed", message: "Not Found", passing: false });
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(502, { message: "Bad Gateway" });
    expect(await send()(card, reply, 1, NOW)).toEqual({ kind: "failed", message: "Bad Gateway", passing: true });
  });
});

describe("githubSender after the final review", () => {
  it("even the first attempt looks for the marker, and finding it posts nothing (a press racing the watcher's resume)", async () => {
    routes["GET /repos/ana/web/issues/12/comments"] = () => json(200, [{ id: 1, body: `Lo miramos hoy.\n\n${markerOf("c1")}` }]);
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(201, { id: 2 });
    expect(await send()(card, reply, 1, NOW)).toEqual({ kind: "sent", result: "#12" });
    expect(posts()).toEqual([]);
  });

  it("a marker check that fails is tried again later, never posted blind", async () => {
    routes["GET /repos/ana/web/issues/12/comments"] = () => json(502, { message: "Bad Gateway" });
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(201, { id: 2 });
    expect(await send()(card, reply, 2, NOW)).toEqual({ kind: "failed", message: "Bad Gateway", passing: true });
    expect(posts()).toEqual([]);
  });

  it("the comment goes to the task's repository, and a card whose task is gone is refused", async () => {
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(201, { id: 2 });
    await send()(card, reply, 1, NOW);
    expect(repoOf).toHaveBeenCalledWith("p1", "owner", undefined, { owner: "ana", repo: "web" });
    pinnedOf.mockResolvedValue(null);
    expect(await send()(card, reply, 1, NOW)).toEqual({ kind: "failed", message: "This card's task no longer exists.", passing: false });
  });

  it("a token that can't be had now, and a secondary rate limit, are tried again", async () => {
    repoOf.mockResolvedValue({ ok: false, reason: "no_token" });
    expect(await send()(card, reply, 1, NOW)).toMatchObject({ kind: "failed", passing: true });
    repoOf.mockResolvedValue({ ok: true, owner: "ana", repo: "web", token: "ghs_x" });
    routes["POST /repos/ana/web/issues/12/comments"] = () => json(403, { message: "You have exceeded a secondary rate limit." }, { "retry-after": "60", "x-ratelimit-remaining": "4000" });
    expect(await send()(card, reply, 1, NOW)).toEqual({ kind: "failed", message: "You have exceeded a secondary rate limit.", passing: true });
  });
});
