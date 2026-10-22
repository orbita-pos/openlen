import { describe, expect, it, vi } from "vitest";

import { memorySecretStore } from "@/lib/functions/secret-store";

import { memoryStripeStore } from "../store";
import { stripeCliDepsFor, type RealStripeCliDeps } from "./real";
import { runStripeCli } from "./run";

const DRAFT_FN = "https://draftrefdraftrefdraf.openlen.app/functions/v1/";

async function setup(answer: (path: string) => unknown) {
  const secrets = memorySecretStore();
  await secrets.set("p", "draft", { STRIPE_SECRET_KEY: "sk_test_draftkey123" }, null);
  await secrets.set("p", "live", { STRIPE_SECRET_KEY: "sk_live_livekey123" }, null);
  const store = memoryStripeStore();
  const saved: { env: string; name: string; value: string }[] = [];
  const f = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(answer(new URL(String(url)).pathname)), { status: 200 }));
  const d: RealStripeCliDeps = {
    secrets,
    store,
    saveSecret: async (_p, env, name, value) => {
      saved.push({ env, name, value });
      await secrets.set("p", env, { [name]: value }, null);
    },
    draftFunctionsUrl: async () => DRAFT_FN,
    f: f as unknown as typeof fetch,
  };
  return { secrets, store, saved, f, deps: await stripeCliDepsFor("p", d) };
}

describe("stripeCliDepsFor", () => {
  it("uses each environment's STRIPE_SECRET_KEY", async () => {
    const { deps } = await setup(() => ({}));
    expect(await deps.keyFor("draft")).toBe("sk_test_draftkey123");
    expect(await deps.keyFor("live")).toBe("sk_live_livekey123");
  });

  it("a created webhook endpoint's secret goes to the draft as STRIPE_WEBHOOK_SECRET, or _<FUNCTION> if taken", async () => {
    let n = 0;
    const { deps, saved, store } = await setup(() => ({ id: `we_${++n}`, url: `${DRAFT_FN}${n === 1 ? "pago" : "pedido-listo"}`, secret: `whsec_secret${n}abcdef` }));
    const first = await runStripeCli(["webhook_endpoints", "create", `--url=${DRAFT_FN}pago`, "--enabled-events=checkout.session.completed"], deps);
    const second = await runStripeCli(["webhook_endpoints", "create", `--url=${DRAFT_FN}pedido-listo`, "--enabled-events=checkout.session.completed"], deps);
    expect(saved).toEqual([
      { env: "draft", name: "STRIPE_WEBHOOK_SECRET", value: "whsec_secret1abcdef" },
      { env: "draft", name: "STRIPE_WEBHOOK_SECRET_PEDIDO_LISTO", value: "whsec_secret2abcdef" },
    ]);
    expect(first.stdout).toContain("(saved as STRIPE_WEBHOOK_SECRET in the draft)");
    expect(second.stdout).toContain("(saved as STRIPE_WEBHOOK_SECRET_PEDIDO_LISTO in the draft)");
    expect((await store.listObjects("p")).map((r) => [r.testId, r.functionName, r.secretName, r.source])).toEqual([
      ["we_1", "pago", "STRIPE_WEBHOOK_SECRET", "cli"],
      ["we_2", "pedido-listo", "STRIPE_WEBHOOK_SECRET_PEDIDO_LISTO", "cli"],
    ]);
  });

  it("masks the keys of both environments in what Len reads", async () => {
    const { deps } = await setup(() => ({ a: "sk_test_draftkey123", b: "sk_live_livekey123" }));
    const r = await runStripeCli(["get", "/v1/balance"], deps);
    expect(r.stdout).not.toMatch(/sk_test_draftkey123|sk_live_livekey123/);
    expect(r.stdout).toContain("[STRIPE_SECRET_KEY]");
  });

  it("records a product created in test mode as the project's", async () => {
    const { deps, store } = await setup(() => ({ id: "curso", object: "product" }));
    await runStripeCli(["products", "create", "--id=curso", "--name=Curso"], deps);
    expect(await store.listObjects("p")).toMatchObject([{ projectId: "p", kind: "product", testId: "curso", source: "cli" }]);
  });
});
