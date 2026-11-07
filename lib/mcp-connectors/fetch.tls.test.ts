// @vitest-environment node
//
// THE REAL NETWORK PATH (the final review's finding 3): `sendPinned` over node's https against a real local TLS server,
// and the official SDK client end to end through the guarded fetch. The host resolves (in the test) to a public-looking
// IP so the guard lets it through; the connection is then sent to 127.0.0.1, where the server listens, keeping the host
// name for SNI, Host and the certificate check. The certificate is made here with openssl; without openssl it skips.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as z from "zod4";

import { openMcp } from "./client";
import { createGuardedFetch, sendPinned } from "./fetch";

function haveOpenssl(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const OPENSSL = haveOpenssl();

let server: https.Server;
let port = 0;
let cert = "";
const seen: { host?: string; servername?: string | false | null; body?: string }[] = [];

async function toWebRequest(req: import("node:http").IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  return new Request(`https://${req.headers.host}${req.url}`, { method: req.method, headers, ...(body.length > 0 ? { body } : {}) });
}

beforeAll(async () => {
  if (!OPENSSL) return;
  const dir = mkdtempSync(join(tmpdir(), "mcp-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=mcp.test", "-addext", "subjectAltName=DNS:mcp.test"], { stdio: "ignore" });
  cert = readFileSync(join(dir, "c.pem"), "utf8");
  // The test's trust: this certificate only, on the agent sendPinned's requests use.
  (https.globalAgent.options as { ca?: string }).ca = cert;
  server = https.createServer({ key: readFileSync(join(dir, "k.pem")), cert }, async (req, res) => {
    const web = await toWebRequest(req);
    seen.push({ host: req.headers.host, servername: (req.socket as import("node:tls").TLSSocket).servername, body: await web.clone().text() });
    const mcp = new McpServer({ name: "tls-fake", version: "1.0.0" });
    mcp.registerTool("echo", { description: "Echo", inputSchema: { text: z.string() } }, async ({ text }) => ({ content: [{ type: "text" as const, text: `echo ${text}` }] }));
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcp.connect(transport);
    const answer = await transport.handleRequest(web);
    res.writeHead(answer.status, Object.fromEntries(answer.headers.entries()));
    if (answer.body) for await (const chunk of answer.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  if (!OPENSSL) return;
  delete (https.globalAgent.options as { ca?: string }).ca;
  https.globalAgent.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe.skipIf(!OPENSSL)("sendPinned over real TLS", () => {
  it("connects to the pinned IP with the host's name for SNI and Host, and streams the answer", async () => {
    seen.length = 0;
    const res = await sendPinned({
      url: new URL(`https://mcp.test:${port}/mcp`),
      address: "127.0.0.1",
      init: { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }), redirect: "manual" },
    });
    expect(res.status).toBeLessThan(500);
    await res.text();
    expect(seen[0]).toMatchObject({ host: `mcp.test:${port}`, servername: "mcp.test", body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
  });

  it("🔴 the certificate is checked against the host name, not the pinned IP", async () => {
    await expect(
      sendPinned({ url: new URL(`https://other.test:${port}/mcp`), address: "127.0.0.1", init: { method: "GET", redirect: "manual" } }),
    ).rejects.toThrow(/altnames|hostname|certificate/i);
  });

  it("the official SDK runs end to end through the guarded fetch", async () => {
    const fetch = createGuardedFetch({
      maxBytes: 1_000_000,
      lookup: async (host) => (host === "mcp.test" ? [{ address: "93.184.216.34", family: 4 }] : []),
      send: (r) => sendPinned({ ...r, address: "127.0.0.1" }),
    });
    const c = await openMcp({ url: `https://mcp.test:${port}/mcp`, headers: { authorization: "Bearer t" } }, { fetch, timeoutMs: 10_000 });
    expect((await c.listTools()).map((t) => t.name)).toEqual(["echo"]);
    expect(await c.callTool("echo", { text: "hi" }, { timeoutMs: 10_000 })).toMatchObject({ content: [{ type: "text", text: "echo hi" }] });
    await c.close();
  });
});
