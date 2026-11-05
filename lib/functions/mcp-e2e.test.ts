// @vitest-environment node
//
// AN MCP SERVER IN AN EDGE FUNCTION, END TO END (spec local 2026-11-04-herramientas-hechas-por-len, §4.6, §4.7): Supabase's
// own example (supabase.com/docs/guides/getting-started/byo-mcp) — `@modelcontextprotocol/server` and zod 4 from the
// functions catalog — bundled for real, deployed on BOTH engines (the local one, and Cloudflare's with each script in
// workerd through miniflare, what production runs) and called through the real gateway with MCP's Streamable HTTP:
// `initialize`, then `tools/list` and `tools/call`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";

import { bundleFunctions } from "./bundler/bundle-functions";
import { FUNCTIONS_CATALOG_CURRENT } from "./catalog";
import { ConcurrencyLimiter } from "./concurrency";
import { memoryDeploymentStore } from "./deployments";
import { CloudflareEngine } from "./engines/cloudflare";
import { FAKE_CONFIG, fakeCloudflare } from "./engines/cloudflare/fake-cloudflare";
import { LocalEngine } from "./engines/local";
import type { Destination, FunctionsEngine } from "./engines/types";
import { handleFunctionsRequest, type GatewayDeps, type ResolvedTarget } from "./gateway";
import { memoryUsageStore } from "./usage";

const T = 120_000;
const REF = "mcpmcpmcpmcpmcpmcpmc";
const HOST = `${REF}.openlen.app`;
const DEST: Destination = { ref: REF, environment: "draft" };

// Supabase's example, verbatim (only the comment line dropped).
const SUPABASE_MCP_EXAMPLE = [
  "import 'jsr:@supabase/functions-js/edge-runtime.d.ts'",
  "",
  "import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0'",
  "import { z } from 'npm:zod@^4.3.6'",
  "",
  "const handler = createMcpHandler(() => {",
  "  const server = new McpServer({ name: 'mcp', version: '0.1.0' })",
  "",
  "  server.registerTool(",
  "    'add',",
  "    {",
  "      title: 'Addition Tool',",
  "      description: 'Add two numbers together',",
  "      inputSchema: z.object({ a: z.number(), b: z.number() }),",
  "    },",
  "    ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] })",
  "  )",
  "",
  "  return server",
  "})",
  "",
  "Deno.serve((req) => handler.fetch(req))",
  "",
].join("\n");

const FILES: Record<string, string> = {
  "/supabase/config.toml": "[functions.mcp]\nverify_jwt = false\n",
  "/supabase/functions/mcp/index.ts": SUPABASE_MCP_EXAMPLE,
};

const TARGET: ResolvedTarget = {
  projectId: "p-mcp",
  ref: REF,
  host: HOST,
  environment: "draft",
  published: true,
  publishableKey: "sb_publishable_mcp",
  secretKeyHash: "x",
  secrets: {},
  jwtSecret: async () => "secreto-jwt-de-prueba-0123456789abcdef",
};

afterAll(() => stopBundlerWorker());

const ENGINES: ReadonlyArray<{ readonly name: string; make(): { engine: FunctionsEngine; stop(): Promise<void> } }> = [
  {
    name: "local",
    make() {
      const engine = new LocalEngine();
      return { engine, stop: () => engine.stopAll() };
    },
  },
  {
    name: "cloudflare",
    make() {
      const cf = fakeCloudflare();
      return { engine: new CloudflareEngine(FAKE_CONFIG, cf.fetch), stop: () => cf.dispose() };
    },
  },
];

describe.each(ENGINES)("Supabase's MCP server in an Edge Function — engine $name", (e) => {
  let engine: FunctionsEngine;
  let stop: () => Promise<void> = async () => undefined;
  const store = memoryDeploymentStore();
  const deps = (): GatewayDeps => ({
    engine,
    resolve: async () => TARGET,
    plan: async () => "pro",
    ensureDeployed: async () => undefined,
    deployment: (p, e) => store.get(p, e),
    maps: (p, e) => store.maps(p, e),
    usage: memoryUsageStore(),
    limiter: new ConcurrencyLimiter(),
    caps: { free: 1e15, paid: 1e15 },
    record: async () => undefined,
    now: () => new Date(),
  });
  const rpc = async (body: Record<string, unknown>, sessionHeaders: Record<string, string> = {}) => {
    const res = await handleFunctionsRequest(
      new Request(`https://${HOST}/functions/v1/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...sessionHeaders },
        body: JSON.stringify({ jsonrpc: "2.0", ...body }),
      }),
      deps(),
    );
    const text = await res.text();
    const json = res.headers.get("content-type")?.includes("text/event-stream")
      ? JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5))
      : JSON.parse(text);
    return { status: res.status, json: json as { result?: Record<string, unknown>; error?: unknown }, headers: res.headers };
  };

  beforeAll(async () => {
    process.env.NEXTAUTH_SECRET ??= "secreto-del-servidor";
    ({ engine, stop } = e.make());
    const b = await bundleFunctions({ files: FILES, catalog: FUNCTIONS_CATALOG_CURRENT, mode: "development" });
    if (!b?.ok) throw new Error(JSON.stringify(b));
    await engine.deploy(DEST, { hash: b.hash, files: b.files }, {}, { timeoutSec: 150, memoryMb: 128 });
    await store.put(
      { projectId: "p-mcp", environment: "draft", catalog: FUNCTIONS_CATALOG_CURRENT, hash: b.hash, functions: b.functions.map((f) => ({ name: f.name, verifyJwt: f.verifyJwt })), deployedAt: new Date() },
      b.maps,
    );
  }, T);
  afterAll(() => stop(), T);

  it("initialize, tools/list and tools/call answer as MCP", { timeout: T }, async () => {
    const init = await rpc({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "openlen", version: "1" } } });
    expect(init.status).toBe(200);
    expect(init.json.result?.serverInfo).toMatchObject({ name: "mcp" });
    const session = init.headers.get("mcp-session-id");
    const h: Record<string, string> = { "mcp-protocol-version": String(init.json.result?.protocolVersion ?? "2025-06-18"), ...(session ? { "mcp-session-id": session } : {}) };
    const list = await rpc({ id: 2, method: "tools/list", params: {} }, h);
    expect((list.json.result?.tools as Array<{ name: string; inputSchema: { type: string } }>).map((t) => [t.name, t.inputSchema.type])).toEqual([["add", "object"]]);
    const call = await rpc({ id: 3, method: "tools/call", params: { name: "add", arguments: { a: 2, b: 3 } } }, h);
    expect(call.json.result).toMatchObject({ content: [{ type: "text", text: "5" }] });
  });
});
