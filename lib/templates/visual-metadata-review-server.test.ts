// @vitest-environment node
import { Buffer } from "node:buffer";
import { request as httpRequest, type ClientRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyReviewCommand,
  buildSafeReviewDto,
  createReviewSession,
  deriveReviewState,
  type ReviewCommand,
} from "./visual-metadata-review-session";
import type {
  ReviewWorkspaceSnapshot,
  VisualMetadataReviewWorkspace,
} from "./visual-metadata-review-session-store";
import type { SuggestionArtifactRow } from "./visual-metadata-review-workflow";
import type { TemplateVisualMetadata } from "./visual-metadata";
import { startVisualMetadataReviewServer, type RunningReviewServer } from "./visual-metadata-review-server";

const METADATA: TemplateVisualMetadata = {
  schemaVersion: "template-visual-metadata/1.0",
  domains: ["saas"],
  audiences: ["businesses"],
  ageRanges: [],
  emotionalRegisters: ["technical"],
  visualArchetypes: ["technical_minimal"],
  visualSignals: ["saas_dashboard"],
  layoutTraits: ["dense"],
  requiredAssetTypes: ["product_mockup"],
  negativeTags: ["children"],
  supportedSiteTypes: ["product_landing"],
  supportedSectionRoles: ["hero", "features", "footer"],
  themeability: "medium",
  identityStrength: "high",
  reviewStatus: "unreviewed",
};

function sourceRow(id: string, screenshotUrl = `https://templates.openlen.com/screenshots/${id}.jpg`): SuggestionArtifactRow {
  return {
    artifactVersion: "template-visual-metadata-suggestion-artifact/1.0",
    recordedAt: "2026-08-03T12:00:00.000Z",
    decision: { version: "template-visual-metadata-suggestion-decision/1.0", outcome: "suggested" },
    id,
    name: `Template ${id}`,
    screenshotUrl,
    metadata: structuredClone(METADATA),
    error: null,
    provenance: {
      workflowVersion: "template-visual-metadata-suggestion-workflow/1.0",
      modelChoice: { version: "template-visual-metadata-model-choice/1.0", modelId: "PRIVATE_MODEL" },
      promptVersion: "template-visual-metadata-prompt/3.0",
      schemaVersion: "template-visual-metadata/1.0",
      generationConfig: {
        version: "template-visual-metadata-generation-config/3.0",
        temperature: 0.2,
        maxOutputTokens: 2_048,
        responseMimeType: "application/json",
        responseJsonSchemaVersion: "template-visual-metadata/1.0",
        thinkingBudget: 0,
      },
      failurePolicy: { version: "template-visual-metadata-failure-policy/1.0", maximumFailureRate: 0.1 },
      timeoutPolicy: { version: "template-visual-metadata-timeout-policy/1.0", timeoutMs: 60_000 },
    },
    evidence: { rawModelResponse: "RAW_MODEL_SECRET" },
  };
}

interface ServerWorkspace extends VisualMetadataReviewWorkspace {
  getSafeReviewDto(): ReturnType<typeof buildSafeReviewDto>;
  getScreenshotSourceUrl(id: string): string | null;
}

function fakeWorkspace(
  rows = [sourceRow("one"), sourceRow("two")],
  reviewer = { name: "Ada Reviewer", email: "ada@example.test" },
) {
  let event = 0;
  let session = createReviewSession({
    sourceSha256: "a".repeat(64),
    rows,
    reviewer,
    now: new Date("2026-08-03T12:00:00.000Z"),
  });
  let currentTemplateId: string | null = rows[0]?.id ?? null;
  const calls: string[] = [];
  const snapshot = (): ReviewWorkspaceSnapshot => ({
    session: structuredClone(session),
    state: deriveReviewState(session, rows),
    currentTemplateId,
  });
  const workspace: ServerWorkspace = {
    snapshot,
    async dispatch(command: ReviewCommand) {
      calls.push(command.action);
      session = applyReviewCommand(session, rows, command, {
        now: () => new Date(`2026-08-03T12:00:${String(++event).padStart(2, "0")}.000Z`),
        eventId: () => `event-${event}`,
      });
      return snapshot();
    },
    async setCurrentTemplate(id: string) {
      calls.push("navigation");
      if (!rows.some((row) => row.id === id)) throw new Error("private unknown id");
      currentTemplateId = id;
      return snapshot();
    },
    async exportFinal() {
      calls.push("export");
      return { reviewedPath: "../private/reviewed.json", auditPath: "../private/audit.json" };
    },
    async exportAuditBackup() {
      calls.push("audit");
      return { auditPath: "../private/audit.json" };
    },
    async close() {
      calls.push("close");
    },
    getSafeReviewDto() {
      const dto = buildSafeReviewDto(session, rows);
      if (dto.session.phase === "review") dto.session.currentTemplateId = currentTemplateId;
      return dto;
    },
    getScreenshotSourceUrl(id: string) {
      return rows.find((row) => row.id === id)?.screenshotUrl ?? null;
    },
  };
  return { workspace, calls };
}

const running: RunningReviewServer[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(running.splice(0).map((server) => server.close()));
});

function fixedRandomBytes() {
  let value = 0;
  return (size: number) => Buffer.alloc(size, ++value);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nodeRequest(args: {
  server: RunningReviewServer;
  path: string;
  method?: string;
  headers?: Record<string, string | number>;
}): {
  request: ClientRequest;
  connected: Promise<void>;
  response: Promise<{ status: number; headers: IncomingHttpHeaders; body: string }>;
} {
  const url = new URL(args.server.origin);
  const response = deferred<{ status: number; headers: IncomingHttpHeaders; body: string }>();
  const connected = deferred<void>();
  const request = httpRequest({
    hostname: url.hostname,
    port: Number(url.port),
    method: args.method ?? "GET",
    path: args.path,
    headers: args.headers,
  }, (incoming) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    incoming.on("end", () => response.resolve({
      status: incoming.statusCode ?? 0,
      headers: incoming.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    }));
  });
  request.on("socket", (socket) => {
    if (socket.connecting) socket.once("connect", connected.resolve);
    else connected.resolve();
  });
  request.on("error", response.reject);
  return { request, connected: connected.promise, response: response.promise };
}

async function bounded<T>(promise: Promise<T>, milliseconds = 500): Promise<T | "bounded_timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<"bounded_timeout">((resolve) => { timer = setTimeout(() => resolve("bounded_timeout"), milliseconds); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function rawSocketRequest(server: RunningReviewServer, wireRequest: string): Promise<string> {
  const url = new URL(server.origin);
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    const chunks: Buffer[] = [];
    socket.on("connect", () => socket.end(wireRequest));
    socket.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}

async function start(args: {
  workspace?: ServerWorkspace;
  workspaceFactory?: (identity: { name: string; email: string }) => Promise<ServerWorkspace>;
  fetchImpl?: typeof fetch;
} = {}) {
  const fallback = fakeWorkspace().workspace;
  const server = await startVisualMetadataReviewServer({
    workspace: args.workspace ?? (args.workspaceFactory ? undefined : fallback),
    workspaceFactory: args.workspaceFactory,
    assets: { javascript: "globalThis.OPENLEN_REVIEW = true;", css: "body{color:#123}" },
    fetchImpl: args.fetchImpl,
    randomBytes: fixedRandomBytes(),
  });
  running.push(server);
  return server;
}

async function exchange(server: RunningReviewServer): Promise<string> {
  const response = await fetch(server.bootstrapUrl, { redirect: "manual" });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe("/");
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return cookie!.split(";", 1)[0];
}

async function authed(server: RunningReviewServer, cookie: string, path: string, init: RequestInit = {}) {
  return fetch(`${server.origin}${path}`, {
    ...init,
    headers: { cookie, ...(init.headers ?? {}) },
    redirect: "manual",
  });
}

function imageFetch(bytes = Buffer.from([0xff, 0xd8, 0xff]), headers: Record<string, string> = {}) {
  return vi.fn(async () => new Response(bytes, {
    status: 200,
    headers: { "content-type": "image/jpeg", "content-length": String(bytes.byteLength), ...headers },
  })) as unknown as typeof fetch;
}

describe("visual metadata review loopback server", () => {
  it("binds explicitly to 127.0.0.1 on an ephemeral port", async () => {
    const server = await start();
    const url = new URL(server.origin);
    expect(url.hostname).toBe("127.0.0.1");
    expect(Number(url.port)).toBeGreaterThan(0);
  });

  it("accepts only the canonical Host authority and rejects foreign absolute-form targets", async () => {
    const server = await start();
    const bootstrap = new URL(server.bootstrapUrl);
    const alternate = nodeRequest({
      server,
      path: `${bootstrap.pathname}${bootstrap.search}`,
      headers: { host: "attacker.example" },
    });
    alternate.request.end();
    expect(await alternate.response).toMatchObject({
      status: 400,
      body: JSON.stringify({ error: "host_rejected" }),
    });

    const absolute = nodeRequest({
      server,
      path: `http://attacker.example${bootstrap.pathname}${bootstrap.search}`,
      headers: { host: bootstrap.host },
    });
    absolute.request.end();
    expect(await absolute.response).toMatchObject({
      status: 400,
      body: JSON.stringify({ error: "request_target_rejected" }),
    });

    const duplicateHost = await rawSocketRequest(server,
      `GET ${bootstrap.pathname}${bootstrap.search} HTTP/1.1\r\nHost: ${bootstrap.host}\r\nHost: ${bootstrap.host}\r\nConnection: close\r\n\r\n`);
    expect(duplicateHost).toContain("400 Bad Request");
    expect(duplicateHost).toContain(JSON.stringify({ error: "host_rejected" }));

    expect((await fetch(server.bootstrapUrl, { redirect: "manual" })).status).toBe(303);
  });

  it("exchanges a one-use bootstrap token for HttpOnly SameSite Strict cookie and redirects", async () => {
    const server = await start();
    const response = await fetch(server.bootstrapUrl, { redirect: "manual" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toMatch(
      /^openlen_review_session=[a-f0-9]+; Path=\/; HttpOnly; SameSite=Strict$/,
    );
  });

  it("rejects a reused bootstrap token", async () => {
    const server = await start();
    expect((await fetch(server.bootstrapUrl, { redirect: "manual" })).status).toBe(303);
    expect((await fetch(server.bootstrapUrl, { redirect: "manual" })).status).toBe(401);
  });

  it("returns 401 without the cookie and 403 for a foreign mutation Origin", async () => {
    const server = await start();
    expect((await fetch(`${server.origin}/api/session`)).status).toBe(401);
    const cookie = await exchange(server);
    const response = await authed(server, cookie, "/api/navigation", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ templateId: "one" }),
    });
    expect(response.status).toBe(403);
  });

  it("sets the restrictive CSP and anti-framing headers", async () => {
    const server = await start();
    const cookie = await exchange(server);
    const response = await authed(server, cookie, "/");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects non-JSON and bodies larger than 64 KiB", async () => {
    const server = await start();
    const cookie = await exchange(server);
    const nonJson = await authed(server, cookie, "/api/navigation", {
      method: "POST",
      headers: { "content-type": "text/plain", origin: server.origin },
      body: "{}",
    });
    expect(nonJson.status).toBe(415);
    const tooLarge = await authed(server, cookie, "/api/navigation", {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ templateId: "x".repeat(65_537) }),
    });
    expect(tooLarge.status).toBe(413);
  });

  it.each([
    ["non-JSON", { "content-type": "text/plain", "content-length": 100_000 }, "x", 415],
    ["declared oversize", { "content-type": "application/json", "content-length": 100_000 }, "{", 413],
    ["streamed oversize", { "content-type": "application/json" }, `"${"x".repeat(65_537)}`, 413],
  ])("terminates a slow %s request so close is bounded", async (_case, headers, partialBody, expectedStatus) => {
    const server = await start();
    const cookie = await exchange(server);
    const slow = nodeRequest({
      server,
      path: "/api/navigation",
      method: "POST",
      headers: { ...headers, cookie, origin: server.origin },
    });
    slow.request.write(partialBody);
    const response = await slow.response;
    expect(response.status).toBe(expectedStatus);
    const closing = server.close();
    const closeOutcome = await bounded(closing);
    if (closeOutcome === "bounded_timeout") {
      slow.request.destroy();
      await closing;
    }
    expect(closeOutcome).not.toBe("bounded_timeout");
  });

  it("opens the workspace through the identity endpoint when runtime identity is absent", async () => {
    const identities: Array<{ name: string; email: string }> = [];
    const server = await start({
      workspaceFactory: async (identity) => {
        identities.push(identity);
        return fakeWorkspace().workspace;
      },
    });
    const cookie = await exchange(server);
    expect(await (await authed(server, cookie, "/api/session")).json()).toEqual({ phase: "identity_required" });
    const created = await authed(server, cookie, "/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ name: " Ada Reviewer ", email: " ada@example.test " }),
    });
    expect(created.status).toBe(200);
    expect(identities).toEqual([{ name: "Ada Reviewer", email: "ada@example.test" }]);
    expect((await authed(server, cookie, "/api/session")).status).toBe(200);
  });

  it("shares one pending identity open only between the same normalized identity", async () => {
    const opening = deferred<ServerWorkspace>();
    const calls: Array<{ name: string; email: string }> = [];
    const factoryCalled = deferred<void>();
    const server = await start({
      workspaceFactory: async (identity) => {
        calls.push(identity);
        factoryCalled.resolve();
        return opening.promise;
      },
    });
    const cookie = await exchange(server);
    const identity = (name: string, email: string) => authed(server, cookie, "/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ name, email }),
    });

    const first = identity(" Ada Reviewer ", " ada@example.test ");
    await factoryCalled.promise;
    const same = identity("Ada Reviewer", "ada@example.test");
    expect(await bounded(same, 50)).toBe("bounded_timeout");
    opening.resolve(fakeWorkspace().workspace);
    const responses = await Promise.all([first, same]);

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(calls).toEqual([{ name: "Ada Reviewer", email: "ada@example.test" }]);
  });

  it("rejects a different identity while an open is pending without leaking either email", async () => {
    const opening = deferred<ServerWorkspace>();
    const calls: Array<{ name: string; email: string }> = [];
    const factoryCalled = deferred<void>();
    const server = await start({
      workspaceFactory: async (identity) => {
        calls.push(identity);
        factoryCalled.resolve();
        return opening.promise;
      },
    });
    const cookie = await exchange(server);
    const identity = (name: string, email: string) => authed(server, cookie, "/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ name, email }),
    });

    const first = identity("Ada Reviewer", "ada@example.test");
    await factoryCalled.promise;
    const foreign = identity("Grace Reviewer", "grace@example.test");
    const foreignBeforeOpen = await bounded(foreign);
    opening.resolve(fakeWorkspace().workspace);
    const firstResponse = await first;
    const foreignResponse = foreignBeforeOpen === "bounded_timeout" ? await foreign : foreignBeforeOpen;

    expect(firstResponse.status).toBe(200);
    expect(foreignBeforeOpen).not.toBe("bounded_timeout");
    expect(foreignResponse.status).toBe(409);
    expect(calls).toEqual([{ name: "Ada Reviewer", email: "ada@example.test" }]);
    const foreignBody = await foreignResponse.text();
    expect(foreignBody).toBe(JSON.stringify({ error: "identity_open_in_progress" }));
    expect(foreignBody).not.toContain("ada@example.test");
    expect(foreignBody).not.toContain("grace@example.test");
  });

  it("rejects a deferred identity body after another request has assigned the workspace", async () => {
    const first = fakeWorkspace(
      [sourceRow("one"), sourceRow("two")],
      { name: "Ada Reviewer", email: "ada@example.test" },
    );
    const replacement = fakeWorkspace(
      [sourceRow("one"), sourceRow("two")],
      { name: "Grace Reviewer", email: "grace@example.test" },
    );
    const identities: Array<{ name: string; email: string }> = [];
    const server = await start({
      workspaceFactory: async (identity) => {
        identities.push(identity);
        return identities.length === 1 ? first.workspace : replacement.workspace;
      },
    });
    const cookie = await exchange(server);
    const delayedBody = JSON.stringify({ name: "Grace Reviewer", email: "grace@example.test" });
    const delayed = nodeRequest({
      server,
      path: "/api/identity",
      method: "POST",
      headers: {
        cookie,
        origin: server.origin,
        expect: "100-continue",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(delayedBody),
      },
    });
    const continued = deferred<void>();
    delayed.request.once("continue", continued.resolve);
    delayed.request.flushHeaders();
    await continued.promise;

    const opened = await authed(server, cookie, "/api/identity", {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ name: "Ada Reviewer", email: "ada@example.test" }),
    });
    expect(opened.status).toBe(200);
    delayed.request.end(delayedBody);
    const rejected = await delayed.response;
    const rejectedBody = rejected.body;

    expect(rejected).toMatchObject({
      status: 409,
      body: JSON.stringify({ error: "identity_already_set" }),
    });
    expect(identities).toEqual([{ name: "Ada Reviewer", email: "ada@example.test" }]);
    expect(rejectedBody).not.toContain("Ada Reviewer");
    expect(rejectedBody).not.toContain("Grace Reviewer");
    expect(rejectedBody).not.toContain("ada@example.test");
    expect(rejectedBody).not.toContain("grace@example.test");
    expect(await (await authed(server, cookie, "/api/session")).json()).toMatchObject({
      reviewerName: "Ada Reviewer",
    });
    await server.close();
    expect(first.calls.filter((call) => call === "close")).toHaveLength(1);
    expect(replacement.calls.filter((call) => call === "close")).toHaveLength(0);
  });

  it("owns a pending open through disconnected clients and rejects an identity completed during close", async () => {
    const opening = deferred<ServerWorkspace>();
    const factoryCalled = deferred<void>();
    const { workspace, calls } = fakeWorkspace();
    const server = await start({
      workspaceFactory: async () => {
        factoryCalled.resolve();
        return opening.promise;
      },
    });
    const cookie = await exchange(server);
    const firstBody = JSON.stringify({ name: "Ada Reviewer", email: "ada@example.test" });
    const first = nodeRequest({
      server,
      path: "/api/identity",
      method: "POST",
      headers: {
        cookie,
        origin: server.origin,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(firstBody),
      },
    });
    first.response.catch(() => undefined);
    first.request.end(firstBody);
    await factoryCalled.promise;
    first.request.destroy();

    const delayedBody = JSON.stringify({ name: "Grace Reviewer", email: "grace@example.test" });
    const delayed = nodeRequest({
      server,
      path: "/api/identity",
      method: "POST",
      headers: {
        cookie,
        origin: server.origin,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(delayedBody),
      },
    });
    delayed.request.flushHeaders();
    await delayed.connected;
    delayed.request.write(delayedBody.slice(0, 1));
    const closing = server.close();
    delayed.request.end(delayedBody.slice(1));
    const delayedBeforeOpen = await bounded(delayed.response);
    expect(await bounded(closing, 50)).toBe("bounded_timeout");
    opening.resolve(workspace);
    const delayedResponse = delayedBeforeOpen === "bounded_timeout" ? await delayed.response : delayedBeforeOpen;
    const closedAfterOpen = await bounded(closing);
    if (closedAfterOpen === "bounded_timeout") await closing;
    await server.close();

    expect(delayedBeforeOpen).not.toBe("bounded_timeout");
    expect(closedAfterOpen).not.toBe("bounded_timeout");
    expect(delayedResponse).toMatchObject({
      status: 503,
      body: JSON.stringify({ error: "server_closing" }),
    });
    expect(calls.filter((call) => call === "close")).toHaveLength(1);
  });

  it("never serializes evidence, rawModelResponse, email, prompts, credentials, or source paths", async () => {
    const rows = [sourceRow("one")];
    rows[0].name = "Safe visible name";
    rows[0].evidence.rawModelResponse = "RAW_MODEL_SECRET";
    rows[0].provenance.modelChoice.modelId = "PRIVATE_MODEL";
    rows[0].screenshotUrl = "https://user:password@templates.openlen.com/private/source.jpg";
    const server = await start({ workspace: fakeWorkspace(rows).workspace });
    const cookie = await exchange(server);
    const responses = await Promise.all([
      authed(server, cookie, "/api/session"),
      authed(server, cookie, "/api/items"),
    ]);
    const serialized = JSON.stringify(await Promise.all(responses.map((response) => response.json())));
    for (const secret of [
      "RAW_MODEL_SECRET", "rawModelResponse", "ada@example.test", "promptVersion",
      "PRIVATE_MODEL", "password", "source.jpg", "provenance", "C:\\private",
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain("Safe visible name");
    expect(serialized).toContain("/api/items/one/screenshot");
    expect(serialized).not.toContain("/api/internal/template-review");
  });

  it("proxies only HTTPS screenshots hosted by templates.openlen.com", async () => {
    const goodFetch = imageFetch();
    const server = await start({ fetchImpl: goodFetch });
    const cookie = await exchange(server);
    const response = await authed(server, cookie, "/api/items/one/screenshot");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");

    for (const url of [
      "http://templates.openlen.com/one.jpg",
      "https://templates.openlen.com.attacker.example/one.jpg",
      "https://user:pass@templates.openlen.com/one.jpg",
      "file:///C:/private/one.jpg",
    ]) {
      const blockedFetch = imageFetch();
      const blocked = await start({ workspace: fakeWorkspace([sourceRow("one", url)]).workspace, fetchImpl: blockedFetch });
      const blockedCookie = await exchange(blocked);
      const blockedResponse = await authed(blocked, blockedCookie, "/api/items/one/screenshot");
      expect(blockedResponse.status).toBe(404);
      expect(blockedFetch).not.toHaveBeenCalled();
    }
    expect(goodFetch).toHaveBeenCalledWith(
      "https://templates.openlen.com/screenshots/one.jpg",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("keeps dot-segment and slash-bearing item IDs inside the screenshot route", async () => {
    const id = "../private";
    const server = await start({
      workspace: fakeWorkspace([sourceRow(id, "https://templates.openlen.com/screenshots/safe.jpg")]).workspace,
      fetchImpl: imageFetch(),
    });
    const cookie = await exchange(server);
    const item = (await (await authed(server, cookie, "/api/items")).json()).items[0];
    expect(item.screenshotEndpoint).toMatch(/^\/api\/items\/~[A-Za-z0-9_-]+\/screenshot$/);
    expect((await authed(server, cookie, item.screenshotEndpoint)).status).toBe(200);
  });

  it("rejects non-image, oversized, and timed-out screenshot responses", async () => {
    const nonImage = await start({
      fetchImpl: vi.fn(async () => new Response("private text", { headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
    });
    expect((await authed(nonImage, await exchange(nonImage), "/api/items/one/screenshot")).status).toBe(502);

    const oversized = await start({
      fetchImpl: imageFetch(Buffer.from([1]), { "content-length": String(20 * 1024 * 1024 + 1) }),
    });
    expect((await authed(oversized, await exchange(oversized), "/api/items/one/screenshot")).status).toBe(502);

    let signalReady!: () => void;
    const signalWasAttached = new Promise<void>((resolve) => { signalReady = resolve; });
    const timedOut = await start({
      fetchImpl: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        signalReady();
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([0xff]));
            init?.signal?.addEventListener("abort", () => controller.error(new DOMException("private timeout", "AbortError")));
          },
        }), { headers: { "content-type": "image/jpeg" } });
      }) as unknown as typeof fetch,
    });
    const timeoutCookie = await exchange(timedOut);
    vi.useFakeTimers();
    const pending = authed(timedOut, timeoutCookie, "/api/items/one/screenshot");
    await signalWasAttached;
    await vi.advanceTimersByTimeAsync(20_001);
    expect((await pending).status).toBe(504);
    vi.useRealTimers();
  });

  it("aborts an upstream screenshot body when the downstream client disconnects and grants no eligibility", async () => {
    const upstreamStarted = deferred<void>();
    const upstreamAborted = deferred<void>();
    let releaseUpstream!: () => void;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          releaseUpstream = () => controller.error(new DOMException("test cleanup", "AbortError"));
          controller.enqueue(new Uint8Array([0xff]));
          init?.signal?.addEventListener("abort", () => {
            upstreamAborted.resolve();
            controller.error(new DOMException("downstream closed", "AbortError"));
          });
          upstreamStarted.resolve();
        },
      }),
      { headers: { "content-type": "image/jpeg" } },
    )) as unknown as typeof fetch;
    const server = await start({ fetchImpl });
    const cookie = await exchange(server);
    const screenshot = nodeRequest({
      server,
      path: "/api/items/one/screenshot",
      headers: { cookie },
    });
    screenshot.response.catch(() => undefined);
    screenshot.request.end();
    await upstreamStarted.promise;
    screenshot.request.destroy();
    const abortOutcome = await bounded(upstreamAborted.promise);
    if (abortOutcome === "bounded_timeout") releaseUpstream();

    expect(abortOutcome).not.toBe("bounded_timeout");
    const decision = await authed(server, cookie, "/api/items/one/decision", {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect(decision.status).toBe(409);
    expect(await decision.json()).toEqual({ error: "screenshot_required" });
  });

  it("prevents approval until that template screenshot was served successfully", async () => {
    const { workspace } = fakeWorkspace();
    const server = await start({ workspace, fetchImpl: imageFetch() });
    const cookie = await exchange(server);
    const approve = (id: string) => authed(server, cookie, `/api/items/${id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify({ decision: "approve" }),
    });
    expect((await approve("one")).status).toBe(409);
    expect((await authed(server, cookie, "/api/items/one/screenshot")).status).toBe(200);
    expect((await approve("two")).status).toBe(409);
    expect((await approve("one")).status).toBe(200);
  });

  it("dispatches edit, approve, reject, reopen, navigation, and export commands", async () => {
    const { workspace, calls } = fakeWorkspace();
    const server = await start({ workspace, fetchImpl: imageFetch() });
    const cookie = await exchange(server);
    const post = (path: string, body: unknown, method = "POST") => authed(server, cookie, path, {
      method,
      headers: { "content-type": "application/json", origin: server.origin },
      body: JSON.stringify(body),
    });
    const gated = await post("/api/export", {});
    expect(gated.status).toBe(409);
    expect(await gated.json()).toEqual({ error: "export_gate_closed" });
    expect((await post("/api/items/one/metadata", { field: "themeability", value: "high" }, "PATCH")).status).toBe(200);
    expect((await authed(server, cookie, "/api/items/one/screenshot")).status).toBe(200);
    expect((await post("/api/items/one/decision", { decision: "approve" })).status).toBe(200);
    expect((await authed(server, cookie, "/api/items/two/screenshot")).status).toBe(200);
    expect((await post("/api/items/two/decision", { decision: "approve" })).status).toBe(200);
    expect((await post("/api/export", {})).status).toBe(200);
    expect((await post("/api/items/one/reopen", {})).status).toBe(200);
    expect((await post("/api/items/one/decision", { decision: "reject", reason: "Not suitable" })).status).toBe(200);
    const navigated = await post("/api/navigation", { templateId: "two" });
    expect(navigated.status).toBe(200);
    expect(await navigated.json()).toMatchObject({ currentTemplateId: "two" });
    expect((await post("/api/export/audit", {})).status).toBe(200);
    expect(calls).toEqual([
      "metadata_updated", "approved", "approved", "export", "reopened", "rejected", "navigation", "audit",
    ]);
    expect(JSON.stringify(await (await post("/api/export/audit", {})).json())).not.toContain("private");
  });
});
