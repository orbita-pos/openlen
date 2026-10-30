// @vitest-environment node
// The snippet in a REAL Chromium, as a visitor's browser runs it (navigator.webdriver set back to
// false): a crashed app sends one report to /c/<projectId> that the server parses, a working one
// sends nothing. jsdom (snippet.test.ts) has no layout or real innerText; this does.
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { allowEgressOrigin } from "@/lib/security/egress-proxy";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";

import { parseWatchReport } from "./report";
import { injectWatchSnippet } from "./snippet";

const CRASHED = injectWatchSnippet('<!doctype html><html><head><title>x</title></head><body><div id="root"></div><script>throw new Error("kaput at https://a.b/c?token=1")</script></body></html>', "p1", null);
const WORKING = injectWatchSnippet('<!doctype html><html><head><title>x</title></head><body><div id="root"><h1>Hola</h1></div></body></html>', "p1", null);

let server: http.Server;
let hostPort: string;
const beacons: unknown[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/c/p1") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        beacons.push(JSON.parse(body));
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(200, { "content-type": "text/html" }).end(req.url === "/rota" ? CRASHED : WORKING);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hostPort = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

async function visit(path: string): Promise<void> {
  const release = allowEgressOrigin(hostPort);
  const browser = await lanzarChromium();
  try {
    const page = await browser.newPage();
    await installSubresourceSsrfGuard(page, { allowOrigins: [hostPort] });
    await page.evaluateOnNewDocument(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));
    await page.goto(`http://${hostPort}${path}`, { waitUntil: "load" });
    await new Promise((r) => setTimeout(r, 6_500));
  } finally {
    release();
    await browser.close();
  }
}

describe("the snippet in a visitor's browser", () => {
  it("a crashed app sends one report, which the server reads clean", async () => {
    beacons.length = 0;
    await visit("/rota");
    expect(beacons).toHaveLength(1);
    const report = parseWatchReport(beacons[0]);
    expect(report).toMatchObject({ message: "Uncaught Error: kaput at https://a.b/c", file: "/rota", page: null });
    // The line of the document as served, snippet included (it goes first in <head>).
    expect(report?.line).toBeGreaterThan(1);
  }, 60_000);

  it("a working app sends nothing", async () => {
    beacons.length = 0;
    await visit("/bien");
    expect(beacons).toHaveLength(0);
  }, 60_000);
});
