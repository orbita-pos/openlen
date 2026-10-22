import { describe, expect, it, vi } from "vitest";

import type { StripeRequest, StripeResponse } from "../api";
import { runStripeCli, type StripeCliDeps } from "./run";
import { CREDENTIALS_ANSWER, LIVE_WRITE_REFUSAL, MEMBER_LIVE_REFUSAL, listenText, noKeyText } from "./texts";

const DRAFT_FN = "https://draftrefdraftrefdraf.openlen.app/functions/v1/";
const res = (status: number, body: unknown): StripeResponse => ({ status, text: JSON.stringify(body, null, 2), json: body, requestId: "req_1" });

function deps(o: { keys?: { draft?: string | null; live?: string | null }; answer?: (key: string, req: StripeRequest) => StripeResponse } = {}) {
  const keys = { draft: "sk_test_d", live: "sk_live_l", ...o.keys };
  const request = vi.fn(async (key: string, req: StripeRequest) => (o.answer ? o.answer(key, req) : res(200, { object: "list", data: [] })));
  const d: StripeCliDeps & { request: typeof request } = {
    keyFor: vi.fn(async (env: "draft" | "live") => keys[env] ?? null),
    request,
    record: vi.fn(async () => {}),
    saveWebhookSecret: vi.fn(async () => "STRIPE_WEBHOOK_SECRET"),
    mask: vi.fn(async (t: string) => t.replaceAll("sk_test_d", "[STRIPE_SECRET_KEY]")),
    draftFunctionsUrl: DRAFT_FN,
    trigger: vi.fn(async () => ({ stdout: "Trigger succeeded! Check dashboard for event details.\n", exitCode: 0 })),
  };
  return d;
}

describe("runStripeCli", () => {
  it("test mode by default with the draft key; the output is Stripe's body, like the CLI", async () => {
    const d = deps({ answer: () => res(200, { object: "list", data: [{ id: "prod_1" }] }) });
    const r = await runStripeCli(["products", "list", "--limit=1"], d);
    expect(d.request).toHaveBeenCalledWith("sk_test_d", { method: "GET", path: "/v1/products", form: "limit=1" });
    expect(r).toEqual({ stdout: `${JSON.stringify({ object: "list", data: [{ id: "prod_1" }] }, null, 2)}\n`, stderr: "", exitCode: 0 });
  });

  it("--live reads with the production key", async () => {
    const d = deps();
    await runStripeCli(["products", "list", "--live"], d);
    expect(d.keyFor).toHaveBeenCalledWith("live");
    expect(d.request.mock.calls[0]![0]).toBe("sk_live_l");
  });

  it("--live refuses a write without calling Stripe", async () => {
    const d = deps();
    for (const args of [["products", "create", "--name=X", "--live"], ["post", "/v1/products", "-d", "name=X", "--live"], ["trigger", "invoice.paid", "--live"], ["customers", "delete", "cus_1", "--live", "--confirm"]]) {
      expect(await runStripeCli(args, d)).toEqual({ stdout: "", stderr: LIVE_WRITE_REFUSAL, exitCode: 1 });
    }
    expect(d.request).not.toHaveBeenCalled();
  });

  it("Final review: a member's turn doesn't read live mode (the owner's payments and customers); test mode still works", async () => {
    const d = deps();
    for (const args of [["customers", "list", "--live"], ["get", "/v1/charges", "--live"]]) {
      expect(await runStripeCli(args, d, { readLive: false })).toEqual({ stdout: "", stderr: MEMBER_LIVE_REFUSAL, exitCode: 1 });
    }
    expect(d.keyFor).not.toHaveBeenCalledWith("live");
    expect(d.request).not.toHaveBeenCalled();
    await runStripeCli(["products", "list"], d, { readLive: false });
    expect(d.request).toHaveBeenCalledTimes(1);
  });

  it("no key → the way out", async () => {
    expect(await runStripeCli(["products", "list"], deps({ keys: { draft: null } }))).toEqual({ stdout: "", stderr: noKeyText("draft"), exitCode: 1 });
    expect(await runStripeCli(["products", "list", "--live"], deps({ keys: { live: null } }))).toEqual({ stdout: "", stderr: noKeyText("live"), exitCode: 1 });
  });

  it("records what a test create makes: product id, price lookup_key, payment link url", async () => {
    const answers: Record<string, unknown> = {
      "/v1/products": { id: "curso", object: "product" },
      "/v1/prices": { id: "price_1Qa", object: "price", lookup_key: "curso" },
      "/v1/payment_links": { id: "plink_1", object: "payment_link", url: "https://buy.stripe.com/test_abc" },
    };
    const d = deps({ answer: (_k, req) => res(200, answers[req.path]) });
    await runStripeCli(["products", "create", "--id=curso", "--name=Curso"], d);
    await runStripeCli(["prices", "create", "--product=curso", "--unit-amount=2900", "--currency=usd", "--lookup-key=curso"], d);
    await runStripeCli(["post", "/v1/payment_links", "-d", "line_items[0][price]=price_1Qa", "-d", "line_items[0][quantity]=1"], d);
    expect(vi.mocked(d.record).mock.calls.map(([x]) => x)).toEqual([
      { kind: "product", testId: "curso" },
      { kind: "price", testId: "price_1Qa", lookupKey: "curso" },
      { kind: "payment_link", testId: "plink_1", testUrl: "https://buy.stripe.com/test_abc" },
    ]);
  });

  it("does not record a failed create, a list, an update or a create in another collection", async () => {
    const d = deps({ answer: (_k, req) => (req.path === "/v1/products" && req.method === "POST" ? res(400, { error: { message: "x" } }) : res(200, { id: "x" })) });
    await runStripeCli(["products", "create", "--name=X"], d);
    await runStripeCli(["products", "list"], d);
    await runStripeCli(["products", "update", "curso", "--name=Y"], d);
    await runStripeCli(["customers", "create", "--email=a@b.c"], d);
    expect(d.record).not.toHaveBeenCalled();
  });

  it("webhook_endpoints create saves the secret and prints its name instead", async () => {
    const d = deps({ answer: () => res(200, { id: "we_1", object: "webhook_endpoint", url: `${DRAFT_FN}webhook-stripe`, secret: "whsec_abcdef123456" }) });
    const r = await runStripeCli(["webhook_endpoints", "create", `--url=${DRAFT_FN}webhook-stripe`, "--enabled-events=checkout.session.completed"], d);
    expect(d.saveWebhookSecret).toHaveBeenCalledWith({ id: "we_1", url: `${DRAFT_FN}webhook-stripe`, secret: "whsec_abcdef123456" });
    expect(r.stdout).toContain('"secret": "(saved as STRIPE_WEBHOOK_SECRET in the draft)"');
    expect(r.stdout).not.toContain("whsec_abcdef123456");
    expect(d.record).toHaveBeenCalledWith({ kind: "webhook_endpoint", testId: "we_1", testUrl: `${DRAFT_FN}webhook-stripe`, functionName: "webhook-stripe" });
  });

  it("masks every output with the project's secrets", async () => {
    const d = deps({ answer: () => res(200, { echo: "sk_test_d" }) });
    const r = await runStripeCli(["get", "/v1/balance"], d);
    expect(r.stdout).toContain("[STRIPE_SECRET_KEY]");
    expect(r.stdout).not.toContain("sk_test_d");
  });

  it("a DELETE without --confirm asks like the CLI and doesn't run", async () => {
    const d = deps();
    const r = await runStripeCli(["products", "delete", "curso"], d);
    expect(r.stdout).toBe(
      "This command will be executed on the account with the following details:\n> Mode: Test\nAre you sure you want to perform the command: DELETE?\nEnter 'yes' to confirm: \nExiting without execution. User did not confirm the command.\n",
    );
    expect(r.exitCode).toBe(0);
    expect(d.request).not.toHaveBeenCalled();
    await runStripeCli(["products", "delete", "curso", "--confirm"], d);
    expect(d.request).toHaveBeenCalledWith("sk_test_d", { method: "DELETE", path: "/v1/products/curso" });
  });

  it("listen explains that the draft already gets the events", async () => {
    const endpoints = [{ url: `${DRAFT_FN}pago`, enabled_events: ["checkout.session.completed"] }];
    const d = deps({ answer: () => res(200, { object: "list", data: endpoints }) });
    expect(await runStripeCli(["listen", "--forward-to", "localhost:4242"], d)).toEqual({
      stdout: listenText([{ url: `${DRAFT_FN}pago`, events: ["checkout.session.completed"] }], DRAFT_FN),
      stderr: "",
      exitCode: 0,
    });
  });

  it("login, config and --api-key answer where the key comes from", async () => {
    expect(await runStripeCli(["login"], deps())).toEqual({ stdout: "", stderr: CREDENTIALS_ANSWER, exitCode: 1 });
  });

  it("a 4xx prints Stripe's error like the CLI (exit 0); a 401 is 'Request failed'", async () => {
    const err = { error: { type: "invalid_request_error", message: "No such product: 'nope'" } };
    expect(await runStripeCli(["products", "retrieve", "nope"], deps({ answer: () => res(404, err) }))).toEqual({ stdout: `${JSON.stringify(err, null, 2)}\n`, stderr: "", exitCode: 0 });
    const r = await runStripeCli(["products", "list"], deps({ answer: () => res(401, { error: { message: "Invalid API Key provided" } }) }));
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/^Request failed, status=401, body=/);
  });

  it("trigger goes to the fixtures with the draft key", async () => {
    const d = deps();
    expect(await runStripeCli(["trigger", "invoice.paid"], d)).toEqual({ stdout: "Trigger succeeded! Check dashboard for event details.\n", stderr: "", exitCode: 0 });
    expect(d.trigger).toHaveBeenCalledWith("invoice.paid", "sk_test_d");
  });

  it("stops when the signal aborts", async () => {
    const ac = new AbortController();
    const d = deps();
    d.request.mockImplementationOnce(() => new Promise(() => {}));
    const p = runStripeCli(["products", "list"], d, { signal: ac.signal });
    ac.abort();
    expect(await p).toEqual({ stdout: "", stderr: "", exitCode: 143 });
  });

  it("help and usage errors come from the parser", async () => {
    expect((await runStripeCli(["products", "--help"], deps())).stdout).toContain("Available Operations:");
    expect(await runStripeCli(["productz"], deps())).toMatchObject({ stdout: "", exitCode: 1 });
  });
});
