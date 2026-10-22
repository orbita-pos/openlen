// @vitest-environment node
//
// REACT EMAIL IN A FUNCTION, END TO END (spec local 2026-10-22-email-integration,
// Task 15): the real functions bundler with the 2026-12 catalog, the `local`
// engine, Resend's SDK from the catalog with `react:`, and OpenLen's email
// gateway (lib/project-email/gateway.ts) behind RESEND_BASE_URL, on a real port.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { hashSecretKey } from "@/lib/backend/keys";
import { handleEmailRequest } from "@/lib/project-email/gateway";
import type { ResendEmail } from "@/lib/project-email/resend-clients";
import { memoryEmailStore } from "@/lib/project-email/store";

import { bundleFunctions } from "./bundler/bundle-functions";
import { ConcurrencyLimiter } from "./concurrency";
import { memoryDeploymentStore } from "./deployments";
import { LocalEngine } from "./engines/local";
import { handleFunctionsRequest, type GatewayDeps, type ResolvedTarget } from "./gateway";
import { memoryUsageStore } from "./usage";

const T = 120_000;
const KEY = "sb_secret_react_email_0123456789";
const REF = "reactemailreactemail";
const HOST = `${REF}.openlen.app`;
const DEST = { ref: REF, environment: "draft" as const };
const PUBLISHABLE = "sb_publishable_react_email";
const TARGET: ResolvedTarget = {
  projectId: "p1",
  ref: REF,
  host: HOST,
  environment: "draft",
  published: true,
  publishableKey: PUBLISHABLE,
  secretKeyHash: hashSecretKey(KEY),
  secrets: {},
  jwtSecret: async () => "j".repeat(48),
};
const deployments = memoryDeploymentStore();

const FILES: Record<string, string> = {
  "/supabase/functions/bienvenida/index.tsx": [
    'import { Resend } from "npm:resend@6";',
    'import { Html, Body, Heading, Button } from "npm:react-email";',
    "",
    "function Bienvenida({ nombre }: { nombre: string }) {",
    "  return (",
    "    <Html>",
    "      <Body>",
    "        <Heading>Hola {nombre}</Heading>",
    '        <Button href="https://taller.mx/menu">Ver el menú</Button>',
    "      </Body>",
    "    </Html>",
    "  );",
    "}",
    "",
    'const resend = new Resend(Deno.env.get("RESEND_API_KEY"));',
    "Deno.serve(async (req) => {",
    "  const { nombre, to } = await req.json();",
    '  const { data, error } = await resend.emails.send({ from: Deno.env.get("OPENLEN_EMAIL_FROM")!, to, subject: "Bienvenida", react: <Bienvenida nombre={nombre} /> });',
    "  return Response.json({ data, error });",
    "});",
    "",
  ].join("\n"),
};

const sent: ResendEmail[] = [];
let server: Server;
let engine: LocalEngine;

function functionsDeps(): GatewayDeps {
  return {
    engine,
    resolve: async () => TARGET,
    plan: async () => "pro",
    ensureDeployed: async () => undefined,
    deployment: (p, e) => deployments.get(p, e),
    maps: (p, e) => deployments.maps(p, e),
    usage: memoryUsageStore(),
    limiter: new ConcurrencyLimiter(),
    caps: { free: 1e15, paid: 1e15 },
    record: async () => {},
    now: () => new Date(),
  };
}

beforeAll(async () => {
  const store = memoryEmailStore();
  await store.putDomain({ projectId: "p1", domain: "taller.mx", sendingHost: "notify.taller.mx", showAsRoot: false, resendDomainId: "rd", records: [], status: "ready", lastCheckedAt: null, verifiedAt: null });
  // The real gateway, with the customers' Resend replaced by a list.
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await handleEmailRequest(
      new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }),
      {
        enabled: () => true,
        resolve: async () => ({ projectId: "p1", environment: "live", secretKeyHash: hashSecretKey(KEY) }),
        store,
        resend: { createDomain: vi.fn(), getDomain: vi.fn(), verifyDomain: vi.fn(), deleteDomain: vi.fn(), send: async (e: ResendEmail) => (sent.push(e), { id: `re_${sent.length}` }) },
        ownerOf: async () => ({ userId: "u1", email: "dueno@taller.mx" }),
        planOf: async () => "pro",
        team: async () => [],
        debitIfEnough: async () => true,
        refund: async () => {},
        unsubscribeUrl: () => "https://openlen.com/u/t",
        notify: async () => {},
        now: () => new Date(),
      },
    );
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;

  const b = await bundleFunctions({ files: FILES, catalog: "2026-12", mode: "development" });
  if (!b?.ok) throw new Error(JSON.stringify(b));
  engine = new LocalEngine();
  await engine.deploy(
    DEST,
    { hash: b.hash, files: b.files },
    { RESEND_API_KEY: KEY, RESEND_BASE_URL: `http://127.0.0.1:${port}/email/v1`, OPENLEN_EMAIL_FROM: "noreply@notify.taller.mx" },
    { timeoutSec: 60, memoryMb: 256 },
  );
  await deployments.put({ projectId: "p1", environment: "draft", catalog: "2026-12", hash: b.hash, functions: b.functions.map((f) => ({ name: f.name, verifyJwt: f.verifyJwt })), deployedAt: new Date() }, b.maps);
}, T);

afterAll(async () => {
  await engine?.stopAll();
  server?.close();
  stopBundlerWorker();
}, T);

describe("React Email in a function", () => {
  it("a function importing react-email and sending with `react:` bundles, and the html reaches the gateway", { timeout: T }, async () => {
    const res = await handleFunctionsRequest(
      new Request(`https://${HOST}/functions/v1/bienvenida`, { method: "POST", headers: { apikey: PUBLISHABLE, "content-type": "application/json" }, body: JSON.stringify({ nombre: "Ana", to: "ana@x.com" }) }),
      functionsDeps(),
    );
    const body = (await res.json()) as { data: { id: string } | null; error: unknown };
    expect(body).toMatchObject({ data: { id: "re_1" }, error: null });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "noreply@notify.taller.mx", to: ["ana@x.com"], subject: "Bienvenida" });
    // React separates two text nodes with an empty comment: «Hola <!-- -->Ana».
    expect(sent[0]!.html).toMatch(/Hola (<!-- -->)?Ana/);
    expect(sent[0]!.html).toContain('href="https://taller.mx/menu"');
  });
});
