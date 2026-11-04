// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { injectToolBridge, serveToolRelease, TOOL_BRIDGE_PATH, type ServeDeps } from "./serve";
import type { ToolInstallationRow } from "./store";

const ROW: ToolInstallationRow = {
  id: "i1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  placement: "rail",
  titles: { en: "Bookings" },
  descriptions: { en: "x" },
  iconPath: "/icon.svg",
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  enabled: true,
  installedAt: new Date(),
  updatedAt: new Date(),
  removedAt: null,
};

const RELEASE = {
  "/index.html": { content: `<!doctype html><html><head><title>B</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`, contentType: "text/html; charset=utf-8" },
  "/src/main.tsx": { content: "console.log(1)", contentType: "text/javascript; charset=utf-8" },
  "/icon.svg": { content: "<svg/>", contentType: "image/svg+xml; charset=utf-8" },
};

const deps = (over: Partial<ServeDeps> = {}): ServeDeps => ({
  readRelease: vi.fn(async () => RELEASE),
  plan: vi.fn(async () => "pro" as const),
  getBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
  planRequiredText: vi.fn(async (locale: string) => (locale === "es" ? "Necesitas un plan de pago" : "You need a paid plan")),
  ...over,
});

const serve = (path: string, d = deps(), row = ROW, acceptLanguage: string | null = "es-MX,es;q=0.9") =>
  serveToolRelease(row, path, { requestHost: "openlen.com", acceptLanguage, env: { NEXT_PUBLIC_SITE_URL: "https://openlen.com", NODE_ENV: "production" } }, d);

describe("injectToolBridge", () => {
  it("puts the bridge first in <head>, once", () => {
    const once = injectToolBridge("<html><head><title>x</title></head></html>");
    expect(once).toBe(`<html><head><script src="${TOOL_BRIDGE_PATH}"></script><title>x</title></head></html>`);
    expect(injectToolBridge(once)).toBe(once);
  });
  it("without a <head>, before everything", () => {
    expect(injectToolBridge("<p>hi</p>")).toBe(`<script src="${TOOL_BRIDGE_PATH}"></script><p>hi</p>`);
  });
});

describe("serveToolRelease", () => {
  it("the shell, with the bridge and the frame headers", async () => {
    const res = await serve("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html.match(/tool-bridge\.js/g)).toHaveLength(1);
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://openlen.com");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("the bridge script, for the app's origins", async () => {
    const res = await serve(TOOL_BRIDGE_PATH);
    expect(res.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    const js = await res.text();
    expect(js).toContain(`"https://openlen.com"`);
    expect(js).toContain("window.openlen");
  });

  it("a file of the release, with its type; a path it doesn't have is a 404", async () => {
    const res = await serve("/src/main.tsx");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe("console.log(1)");
    expect((await serve("/nope.js")).status).toBe(404);
  });

  it("a binary file comes as its bytes, never its pointer", async () => {
    const pointer = "￿openlen-blob:" + "a".repeat(64) + ":3:" + "b".repeat(40);
    const d = deps({ readRelease: vi.fn(async () => ({ ...RELEASE, "/img/a.png": { content: pointer, contentType: "image/png" } })) });
    const res = await serve("/img/a.png", d);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("switched off or removed: 404", async () => {
    expect((await serve("/", deps(), { ...ROW, enabled: false })).status).toBe(404);
    expect((await serve("/", deps(), { ...ROW, removedAt: new Date() })).status).toBe(404);
  });

  it("its release gone: 404", async () => {
    expect((await serve("/", deps({ readRelease: vi.fn(async () => null) }))).status).toBe(404);
  });

  it("the person dropped to Free: 402, in their language (Review Focus 5)", async () => {
    const res = await serve("/", deps({ plan: vi.fn(async () => "free" as const) }));
    expect(res.status).toBe(402);
    expect(await res.text()).toContain("Necesitas un plan de pago");
    const en = await serve("/", deps({ plan: vi.fn(async () => "free" as const) }), ROW, null);
    expect(await en.text()).toContain("You need a paid plan");
  });
});
