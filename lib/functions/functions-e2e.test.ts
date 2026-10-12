// @vitest-environment node
//
// DE PUNTA A PUNTA, SIN BASE: el empaquetador de verdad, el motor local de
// verdad, la puerta de verdad y los CLIENTES de verdad —supabase-js con
// `functions.invoke`, y el SDK de Stripe (del catálogo) verificando un webhook
// firmado—. Lo de la base va en memoria.
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { hashSecretKey } from "@/lib/backend/keys";
import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";

import { bundleFunctions } from "./bundler/bundle-functions";
import { ConcurrencyLimiter } from "./concurrency";
import { memoryDeploymentStore } from "./deployments";
import { LocalEngine } from "./engines/local";
import { handleFunctionsRequest, type GatewayDeps, type InvocationRecord, type ResolvedTarget } from "./gateway";
import { memoryUsageStore } from "./usage";

const T = 90_000;
const REF = "abcdefghijklmnopqrst";
const HOST = `${REF}.openlen.app`;
const PUBLICABLE = "sb_publishable_e2e";
const SECRETA = "sb_secret_e2e_0123456789abcdef";
const WHSEC = "whsec_prueba_0123456789";
const engine = new LocalEngine();
const store = memoryDeploymentStore();
const records: InvocationRecord[] = [];

const FUENTES: Record<string, string> = {
  "/supabase/config.toml": "[functions.stripe-webhook]\nverify_jwt = false\n",
  "/supabase/functions/_shared/cors.ts": 'export const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };\n',
  "/supabase/functions/hello/index.ts": [
    'import "jsr:@supabase/functions-js/edge-runtime.d.ts";',
    'import { corsHeaders } from "../_shared/cors.ts";',
    "Deno.serve(async (req) => {",
    '  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });',
    "  const { name } = await req.json();",
    '  console.log("saludo para", name);',
    '  return new Response(JSON.stringify({ message: `Hello ${name}!` }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });',
    "});",
    "",
  ].join("\n"),
  "/supabase/functions/stripe-webhook/index.ts": [
    'import Stripe from "npm:stripe@23";',
    'const stripe = new Stripe("sk_test_dummy", { httpClient: Stripe.createFetchHttpClient() });',
    "const crypto = Stripe.createSubtleCryptoProvider();",
    "Deno.serve(async (req) => {",
    '  const signature = req.headers.get("Stripe-Signature")!;',
    "  const body = await req.text();",
    "  try {",
    '    const event = await stripe.webhooks.constructEventAsync(body, signature, Deno.env.get("STRIPE_WEBHOOK_SECRET")!, undefined, crypto);',
    "    return Response.json({ received: event.type });",
    "  } catch (e) {",
    "    return new Response((e as Error).message, { status: 400 });",
    "  }",
    "});",
    "",
  ].join("\n"),
  "/supabase/functions/hostil/index.ts": [
    "Deno.serve(() => Response.json({",
    "  deno: Object.keys(Deno.env.toObject()).sort(),",
    "  proc: Object.keys(process.env),",
    '  role: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),',
    "}));",
    "",
  ].join("\n"),
  "/supabase/functions/rota/index.ts": 'Deno.serve(() => { const p = undefined as unknown as { price: number }; return new Response(String(p.price)); });\n',
};

const TARGET: ResolvedTarget = {
  projectId: "p-e2e",
  ref: REF,
  host: HOST,
  environment: "draft",
  publishableKey: PUBLICABLE,
  secretKeyHash: hashSecretKey(SECRETA),
  secrets: { SUPABASE_SERVICE_ROLE_KEY: SECRETA },
  jwtSecret: async () => "j".repeat(48),
};

function deps(o: Partial<GatewayDeps> = {}): GatewayDeps {
  return {
    engine,
    resolve: async () => TARGET,
    plan: async () => "free",
    ensureDeployed: async () => undefined,
    deployment: (p, e) => store.get(p, e),
    maps: (p, e) => store.maps(p, e),
    usage: memoryUsageStore(),
    limiter: new ConcurrencyLimiter(),
    caps: { free: 1e15, paid: 1e15 },
    record: async (r) => void records.push(r),
    now: () => new Date(),
    ...o,
  };
}

beforeAll(async () => {
  process.env.NEXTAUTH_SECRET ??= "secreto-del-servidor";
  const b = await bundleFunctions({ files: FUENTES, catalog: "2026-11", mode: "development" });
  if (!b?.ok) throw new Error(JSON.stringify(b));
  await engine.deploy(
    { ref: REF, environment: "draft" },
    { hash: b.hash, files: b.files },
    {
      SUPABASE_URL: `https://draftrefdraftrefdraf.openlen.app`,
      SUPABASE_SERVICE_ROLE_KEY: SECRETA,
      STRIPE_WEBHOOK_SECRET: WHSEC,
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    },
    { timeoutSec: 150, memoryMb: 256 },
  );
  await store.put({ projectId: "p-e2e", environment: "draft", catalog: "2026-11", hash: b.hash, functions: b.functions.map((f) => ({ name: f.name, verifyJwt: f.verifyJwt })), deployedAt: new Date() }, b.maps);
}, T);
afterAll(async () => {
  await engine.stopAll();
  stopBundlerWorker();
});

const supabase = (d: GatewayDeps) =>
  createClient(`https://${HOST}`, PUBLICABLE, { global: { fetch: (input, init) => handleFunctionsRequest(new Request(input as RequestInfo, init), d) } });

describe("de punta a punta", () => {
  it("supabase.functions.invoke de verdad, con su registro", { timeout: T }, async () => {
    const { data, error } = await supabase(deps()).functions.invoke("hello", { body: { name: "Ana" } });
    expect(error).toBeNull();
    expect(data).toEqual({ message: "Hello Ana!" });
    await vi.waitFor(() => expect(records.some((r) => r.name === "hello" && r.logs.some((l) => l.msg === "saludo para Ana"))).toBe(true));
  });

  it("el webhook de Stripe: firma buena → 200; mala → 400 (el SDK real del catálogo)", { timeout: T }, async () => {
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: {} } });
    const t = Math.floor(Date.now() / 1000);
    const firma = createHmac("sha256", WHSEC).update(`${t}.${payload}`).digest("hex");
    const enviar = (sig: string) =>
      handleFunctionsRequest(new Request(`https://${HOST}/functions/v1/stripe-webhook`, { method: "POST", headers: { "stripe-signature": sig, "content-type": "application/json" }, body: payload }), deps());
    const ok = await enviar(`t=${t},v1=${firma}`);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ received: "checkout.session.completed" });
    const mala = await enviar(`t=${t},v1=${"0".repeat(64)}`);
    expect(mala.status).toBe(400);
    await mala.arrayBuffer();
  });

  it("🔴 brazo de control: la función no ve nada del servidor ni de AWS; lo que devuelve llega tal cual al visitante (el tapado es para Len)", { timeout: T }, async () => {
    const r = await handleFunctionsRequest(new Request(`https://${HOST}/functions/v1/hostil`, { headers: { authorization: `Bearer ${PUBLICABLE}` } }), deps());
    const j = (await r.json()) as { deno: string[]; proc: string[]; role: string };
    expect(j.deno).toEqual(["STRIPE_WEBHOOK_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"]);
    expect(j.proc).not.toContain("NEXTAUTH_SECRET");
    expect(j.proc).not.toContain("DATABASE_URL");
    expect(j.role).toBe(SECRETA);
  });

  it("un error de Len: 500 WORKER_ERROR y la traza en SU fichero y línea", { timeout: T }, async () => {
    const r = await handleFunctionsRequest(new Request(`https://${HOST}/functions/v1/rota`, { headers: { apikey: PUBLICABLE } }), deps());
    expect(r.status).toBe(500);
    await vi.waitFor(() => expect(records.some((x) => x.name === "rota")).toBe(true));
    const rec = records.find((x) => x.name === "rota")!;
    expect(rec.errorCode).toBe("WORKER_ERROR");
    expect(rec.error).toMatch(/Cannot read properties of undefined \(reading 'price'\)/);
    expect(rec.error).toMatch(/supabase\/functions\/rota\/index\.ts:1:\d+/);
  });

  it("🔴 el tope de dinero: bolsa a $0,0001 → 429 y el motor ni se entera", { timeout: T }, async () => {
    const antes = records.length;
    const r = await handleFunctionsRequest(new Request(`https://${HOST}/functions/v1/stripe-webhook`, { method: "POST", body: "{}" }), deps({ caps: { free: 100_000, paid: 1e15 } }));
    expect(r.status).toBe(429);
    expect(r.headers.get("sb-error-code")).toBe("QUOTA_EXCEEDED");
    expect(records.length).toBe(antes);
  });
});
