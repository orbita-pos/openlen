// @vitest-environment node
// Len Watch's confirmation in a real Chromium (the eyes' launcher): a crashed app is blank with its
// error, a page with content loads, a 500 doesn't answer — and every request skips caches.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkPublishedLoads, withCacheBuster } from "./check";

let server: http.Server;
let hostPort: string;
const requested: string[] = [];

const PAGES: Record<string, { status: number; body: string }> = {
  "/rota": { status: 200, body: '<!doctype html><html><body><div id="root"></div><script>throw new Error("kaput")</script></body></html>' },
  "/bien": { status: 200, body: "<!doctype html><html><body><h1>Hola</h1></body></html>" },
  "/500": { status: 500, body: "nope" },
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requested.push(req.url ?? "");
    const page = PAGES[(req.url ?? "").split("?")[0]!];
    res.writeHead(page?.status ?? 404, { "content-type": "text/html" });
    res.end(page?.body ?? "");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hostPort = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

const check = (path: string) => checkPublishedLoads(`http://${hostPort}${path}`, { allowOrigins: [hostPort], settleMs: 300, now: () => 42 });

describe("checkPublishedLoads", () => {
  it("a crashed app is blank, with its error", async () => {
    const r = await check("/rota");
    expect(r.loads).toBe(false);
    expect(r.reason).toBe("blank");
    expect(r.errors[0]).toContain("kaput");
  }, 60_000);

  it("a page with content loads", async () => {
    expect(await check("/bien")).toEqual({ loads: true, reason: "ok", errors: [] });
  }, 60_000);

  it("a 500 doesn't answer", async () => {
    const r = await check("/500");
    expect(r).toMatchObject({ loads: false, reason: "unreachable" });
  }, 60_000);

  it("asks past any cache", async () => {
    await check("/bien");
    expect(requested.some((u) => u.startsWith("/bien?_lw=42"))).toBe(true);
  }, 60_000);
});

describe("withCacheBuster", () => {
  it("adds _lw to whatever query the URL has", () => {
    expect(withCacheBuster("https://a.b/x?y=1", 5)).toBe("https://a.b/x?y=1&_lw=5");
    expect(withCacheBuster("https://a.b/x", 5)).toBe("https://a.b/x?_lw=5");
  });
});
