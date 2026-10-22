// @vitest-environment node
//
// PUBLISHING WITH STRIPE, for real (spec local 2026-10-21-stripe-integration, §6.4):
// `publishProject` against the throwaway database, the release on a temp disk, and a
// Stripe in memory. The page's test payment link goes out as the live one; the
// sources and the published hashes keep the test one; publishing again copies nothing.
// Runs ONLY on a throwaway database: DATABASE_URL=postgres://postgres@127.0.0.1:5562/openlen.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
// Stripe on without starting the functions engine: this page has no functions.
vi.mock("@/lib/stripe/enabled", () => ({ stripeEnabled: () => true, stripeEnabledIn: () => true }));

const ROOT = mkdtempSync(path.join(tmpdir(), "ol-stripe-e2e-"));
process.env.PUBLISH_ROOT = ROOT;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";
process.env.OPENLEN_IMAGERY = "0";
process.env.NEXTAUTH_SECRET ??= "test-secret-for-the-stripe-e2e";

import { db, schema } from "@/lib/db";
import { pgSecretStore } from "@/lib/functions/secret-store-pg";
import { exigirBaseLocal } from "@/lib/len-bench/entorno";
import { publishProject } from "@/lib/projects";

import { stripeCall } from "./api";
import { pgStripeStore } from "./store-pg";
import { fakeStripe } from "./twins/fake-stripe";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const PID = "test-stripe-publish-e2e";
const UID = `${PID}-u`;
const SUB = "e2estripepublish";
const stripe = fakeStripe();
let testLink = "";

function served(): string {
  const base = path.join(ROOT, SUB);
  try {
    return readFileSync(path.join(base, "current", "index.html"), "utf8");
  } catch {
    const sha = readFileSync(path.join(base, "current"), "utf8").trim();
    return readFileSync(path.join(base, "releases", sha, "index.html"), "utf8");
  }
}

beforeAll(async () => {
  await exigirBaseLocal();
  vi.stubGlobal("fetch", stripe.fetch);
  const t = <T>(p: string, params: Record<string, unknown>) => stripeCall<T>("sk_test_x", "POST", p, params, { f: stripe.fetch });
  await t("/v1/products", { id: "curso-e2e", name: "Curso" });
  const price = await t<{ id: string }>("/v1/prices", { product: "curso-e2e", unit_amount: 2900, currency: "usd", lookup_key: "curso-e2e" });
  const link = await t<{ url: string }>("/v1/payment_links", { line_items: [{ price: price.id, quantity: 1 }] });
  testLink = link.url;
  await db.delete(schema.projects).where(eq(schema.projects.id, PID));
  await db.insert(schema.users).values({ id: UID, email: `${PID}@test.invalid`, name: "Test" }).onConflictDoNothing();
  await db.insert(schema.projects).values({
    id: PID,
    userId: UID,
    title: "Curso",
    brief: "",
    data: { html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Curso</title></head><body><a id="buy" href="${testLink}">Comprar</a></body></html>` },
  });
  await pgSecretStore.set(PID, "draft", { STRIPE_SECRET_KEY: "sk_test_x" }, null);
  await pgSecretStore.set(PID, "live", { STRIPE_SECRET_KEY: "sk_live_x" }, null);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await db.delete(schema.projects).where(eq(schema.projects.id, PID));
  await db.delete(schema.users).where(eq(schema.users.id, UID));
  rmSync(ROOT, { recursive: true, force: true });
});

describe("publishProject with Stripe", () => {
  it("publishes the live payment link, keeps the test one in the sources, and says what it copied", async () => {
    const r = await publishProject({ projectId: PID, userId: UID, subdomain: SUB, skipFlightCheck: true, bypassSubdomainLimit: true, dataChanges: { mode: "owner" } });
    const [liveLink] = stripe.all("live", "payment_link");
    expect(liveLink).toBeDefined();
    const html = served();
    expect(html).toContain(String(liveLink!.url));
    expect(html).not.toContain(testLink);
    const [row] = await db.select({ publishedHtml: schema.projects.publishedHtml }).from(schema.projects).where(eq(schema.projects.id, PID));
    expect(row!.publishedHtml).toContain(testLink);
    expect(r.stripe).toMatchObject({ created: { products: 1, prices: 1, paymentLinks: 1 }, swaps: 1 });
    expect((await pgStripeStore.listObjects(PID)).every((o) => o.liveId)).toBe(true);
  });

  it("publishing again copies nothing", async () => {
    const before = stripe.liveWrites();
    await publishProject({ projectId: PID, userId: UID, subdomain: SUB, skipFlightCheck: true, bypassSubdomainLimit: true, dataChanges: { mode: "owner" } });
    expect(stripe.liveWrites()).toBe(before);
    expect(served()).toContain(String(stripe.all("live", "payment_link")[0]!.url));
  });
});
