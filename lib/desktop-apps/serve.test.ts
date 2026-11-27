// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { TOOL_BRIDGE_PATH } from "@/lib/tools/serve";

import { serveDesktopApp, type DesktopServeDeps } from "./serve";
import type { DesktopAppRow } from "./store";

const PLAIN: DesktopAppRow = {
  id: "d1",
  personId: "u1",
  projectId: "p1",
  releaseSha: "sha1",
  name: "Bookings",
  iconPath: null,
  toolInstallationId: null,
  filesFingerprint: "fp1",
  hostLabel: "lienzo-0123456789abcdef0123456789abcdef",
  installedAt: new Date(),
  updatedAt: new Date(),
  removedAt: null,
};
const TOOL: DesktopAppRow = { ...PLAIN, toolInstallationId: "ti1", iconPath: "/icon.svg" };

const RELEASE = {
  "/index.html": { content: `<!doctype html><html><head><title>B</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`, contentType: "text/html; charset=utf-8" },
  "/src/main.tsx": { content: "console.log(1)", contentType: "text/javascript; charset=utf-8" },
  [TOOL_BRIDGE_PATH]: { content: "alert('a release file must never answer the bridge path')", contentType: "text/javascript; charset=utf-8" },
};

const deps = (over: Partial<DesktopServeDeps> = {}): DesktopServeDeps => ({
  readRelease: vi.fn(async () => RELEASE),
  plan: vi.fn(async () => "pro" as const),
  getBlob: vi.fn(async () => new Uint8Array([1, 2, 3])),
  planRequiredText: vi.fn(async (locale: string) => (locale === "es" ? "Necesitas un plan de pago" : "You need a paid plan")),
  toolInstallation: vi.fn(async () => ({ enabled: true, removedAt: null })),
  ...over,
});

const ENV = { NEXT_PUBLIC_SITE_URL: "https://openlen.com", NODE_ENV: "production" };
const serve = (path: string, row: DesktopAppRow = PLAIN, d: DesktopServeDeps = deps(), acceptLanguage: string | null = "es-MX,es;q=0.9") =>
  serveDesktopApp(row, path, { requestHost: "openlen.com", acceptLanguage, env: ENV }, d);

describe("serveDesktopApp — an ordinary app", () => {
  it("plain app index has no bridge script", async () => {
    const res = await serve("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBe(RELEASE["/index.html"].content);
    expect(html).not.toContain("tool-bridge.js");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("plain app bridge path is 404, even if the release has a file there", async () => {
    expect((await serve(TOOL_BRIDGE_PATH)).status).toBe(404);
  });

  it("a plain app never asks about a tool installation", async () => {
    const d = deps();
    await serve("/", PLAIN, d);
    expect(d.toolInstallation).not.toHaveBeenCalled();
  });

  it("a file of the release comes with its type; a path it doesn't have is a 404", async () => {
    const res = await serve("/src/main.tsx");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(await res.text()).toBe("console.log(1)");
    expect((await serve("/nope.js")).status).toBe(404);
  });

  it("a binary file comes as its bytes, never its pointer", async () => {
    const pointer = "￿openlen-blob:" + "a".repeat(64) + ":3:" + "b".repeat(40);
    const d = deps({ readRelease: vi.fn(async () => ({ ...RELEASE, "/img/a.png": { content: pointer, contentType: "image/png" } })) });
    expect(new Uint8Array(await (await serve("/img/a.png", PLAIN, d)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("it reads the release the row names", async () => {
    const d = deps();
    await serve("/", { ...PLAIN, releaseSha: "sha-9" }, d);
    expect(d.readRelease).toHaveBeenCalledWith("sha-9");
  });

  it("frame-ancestors is the app origin", async () => {
    const res = await serve("/");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://openlen.com");
  });

  it("missing release is 404", async () => {
    expect((await serve("/", PLAIN, deps({ readRelease: vi.fn(async () => null) }))).status).toBe(404);
  });

  it("a removed row is 404, before anything is read", async () => {
    const d = deps();
    expect((await serve("/", { ...PLAIN, removedAt: new Date() }, d)).status).toBe(404);
    expect(d.readRelease).not.toHaveBeenCalled();
  });

  it("free plan gets 402 page, in the person's language", async () => {
    const d = deps({ plan: vi.fn(async () => "free" as const) });
    const res = await serve("/", PLAIN, d);
    expect(res.status).toBe(402);
    expect(await res.text()).toContain("Necesitas un plan de pago");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://openlen.com");
    expect(d.plan).toHaveBeenCalledWith("u1");
    expect(d.readRelease).not.toHaveBeenCalled();
    const en = await serve("/", PLAIN, d, null);
    expect(await en.text()).toContain("You need a paid plan");
  });
});

describe("serveDesktopApp — a tool on the desktop", () => {
  it("tool on desktop gets the bridge", async () => {
    const page = await serve("/", TOOL);
    expect(page.status).toBe(200);
    expect((await page.text()).match(/tool-bridge\.js/g)).toHaveLength(1);
    const bridge = await serve(TOOL_BRIDGE_PATH, TOOL);
    expect(bridge.status).toBe(200);
    expect(bridge.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    const js = await bridge.text();
    expect(js).toContain(`"https://openlen.com"`);
    expect(js).toContain("window.openlen");
  });

  it("it asks about the installation the row points at", async () => {
    const d = deps();
    await serve("/", TOOL, d);
    expect(d.toolInstallation).toHaveBeenCalledWith("ti1");
  });

  it("tool on desktop whose installation is switched off is 404", async () => {
    for (const installation of [{ enabled: false, removedAt: null }, { enabled: true, removedAt: new Date() }, null]) {
      const d = deps({ toolInstallation: vi.fn(async () => installation) });
      expect((await serve("/", TOOL, d)).status).toBe(404);
      expect((await serve(TOOL_BRIDGE_PATH, TOOL, d)).status).toBe(404);
      expect(d.readRelease).not.toHaveBeenCalled();
    }
  });

  it("a lookup that fails is a 404, never a page", async () => {
    const d = deps({ toolInstallation: vi.fn(async () => Promise.reject(new Error("db down"))) });
    expect((await serve("/", TOOL, d)).status).toBe(404);
  });

  it("free plan gets 402 page", async () => {
    const res = await serve("/", TOOL, deps({ plan: vi.fn(async () => "free" as const) }));
    expect(res.status).toBe(402);
  });
});
