// @vitest-environment node
//
// EL PAQUETE EN WORKERD (spec local 2026-10-12, Parte 2): el de verdad, por su
// entrada de Cloudflare (`worker.mjs`), en el motor de Cloudflare en local
// (miniflare). Las seis librerías del catálogo, tal como se empaquetan.
import { afterAll, describe, expect, it } from "vitest";

import { stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";

import { loadMiniflare, scriptOptions } from "../engines/cloudflare/miniflare-for-tests";
import type { Frame } from "../engines/types";
import { bundleFunctions } from "./bundle-functions";

afterAll(() => stopBundlerWorker());

const T = 120_000;
const evento = (fn: string) => ({ fn, method: "GET", path: "", query: "", headers: [], bodyB64: null, host: "abcdefghijklmnopqrst.openlen.app", remoteAddr: "203.0.113.9" });
const marcos = async (r: Response) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Frame);
const cuerpo = (fs: Frame[]) => fs.flatMap((f) => (f.t === "body" ? [Buffer.from(f.b, "base64").toString()] : [])).join("");

const SONDA = [
  'import Stripe from "npm:stripe@23";',
  'import { MercadoPagoConfig, Preference } from "npm:mercadopago";',
  'import OpenAI from "npm:openai";',
  'import { Resend } from "npm:resend";',
  'import { createClient } from "npm:@supabase/supabase-js@2";',
  'import { z } from "npm:zod";',
  "",
  "Deno.serve(async () => {",
  "  const out: Record<string, string> = {};",
  "  const probar = async (k: string, f: () => unknown) => { try { await f(); out[k] = \"ok\"; } catch (e) { out[k] = \"ERROR \" + String((e as Error)?.message ?? e); } };",
  '  await probar("stripe", () => { const s = new Stripe("sk_test_123"); if (!s.webhooks) throw new Error("sin webhooks"); });',
  '  await probar("stripe-firma", async () => {',
  '    const s = new Stripe("sk_test_123");',
  '    const cuerpo = JSON.stringify({ id: "evt_1", object: "event" });',
  '    const cabecera = await s.webhooks.generateTestHeaderStringAsync({ payload: cuerpo, secret: "whsec_x" });',
  '    await s.webhooks.constructEventAsync(cuerpo, cabecera, "whsec_x", undefined, Stripe.createSubtleCryptoProvider());',
  "  });",
  '  await probar("mercadopago", () => { new Preference(new MercadoPagoConfig({ accessToken: "TEST-1" })); });',
  '  await probar("openai", () => new OpenAI({ apiKey: "sk-x" }));',
  '  await probar("resend", () => new Resend("re_x"));',
  '  await probar("supabase", () => createClient("https://abcdefghijklmnopqrst.openlen.app", "sb_publishable_x"));',
  '  await probar("zod", () => z.object({ a: z.string() }).parse({ a: "x" }));',
  '  await probar("env", () => { if (Deno.env.get("MI_SECRETO") !== "valor") throw new Error("env: " + Deno.env.get("MI_SECRETO")); });',
  '  console.log("registro desde la función");',
  "  return Response.json(out);",
  "});",
  "",
].join("\n");

describe("el paquete en workerd", () => {
  it("🔴 las seis librerías del catálogo, Deno.env y los registros, por worker.mjs", { timeout: T }, async () => {
    const b = await bundleFunctions({ catalog: "2026-11", mode: "production", files: { "/supabase/functions/sonda/index.ts": SONDA } });
    expect(b?.ok).toBe(true);
    if (!b?.ok) return;
    const Miniflare = loadMiniflare();
    const mf = new Miniflare(scriptOptions(b.files, { MI_SECRETO: "valor" }));
    try {
      const r = await mf.dispatchFetch("https://function.internal/", { method: "POST", body: JSON.stringify(evento("sonda")) });
      expect(r.headers.get("content-type")).toBe("application/x-ndjson");
      const fs = await marcos(r);
      expect(fs).toContainEqual({ t: "log", level: "log", msg: "registro desde la función" });
      expect(JSON.parse(cuerpo(fs))).toEqual({ stripe: "ok", "stripe-firma": "ok", mercadopago: "ok", openai: "ok", resend: "ok", supabase: "ok", zod: "ok", env: "ok" });
      expect(fs.at(-1)!.t).toBe("end");
      const nada = await marcos(await mf.dispatchFetch("https://function.internal/", { method: "POST", body: JSON.stringify(evento("no-existe")) }));
      expect(nada).toEqual([{ t: "error", kind: "not_found" }, expect.objectContaining({ t: "end" })]);
    } finally {
      await mf.dispose();
    }
  });
});
