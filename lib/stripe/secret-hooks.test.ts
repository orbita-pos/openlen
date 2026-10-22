import { describe, expect, it, vi } from "vitest";

import type { StripeEnv } from "./api";
import type { StripeKeyCheck } from "./key-check";
import { stripeKeyMessage, stripeSecretHook } from "./secret-hooks";
import { memoryStripeStore } from "./store";

const good = (accountId: string, livemode: boolean): StripeKeyCheck => ({
  ok: true,
  account: { accountId, accountName: "Taller", keyKind: "rk", livemode, chargesEnabled: livemode ? false : null },
});

function setup(checks: Record<string, StripeKeyCheck> = {}) {
  const store = memoryStripeStore();
  const check = vi.fn(async (value: string, _env: StripeEnv) => checks[value] ?? { ok: false as const, problem: "rejected_by_stripe" as const });
  const deleteEndpoints = vi.fn(async (_p: string, _e: StripeEnv) => ["STRIPE_WEBHOOK_SECRET"] as readonly string[]);
  const hook = stripeSecretHook({ store, check, deleteEndpoints });
  return { store, check, deleteEndpoints, hook };
}

describe("stripeSecretHook.prepare", () => {
  it("lets anything that is not STRIPE_SECRET_KEY through untouched", async () => {
    const { hook, check } = setup();
    expect(await hook.prepare!("p", [{ environment: "draft", name: "TOKEN", value: "x" }])).toEqual({});
    expect(check).not.toHaveBeenCalled();
  });

  it("rejects a live key for the draft with a message that names the way out", async () => {
    const { hook } = setup({ sk_live_abc123: { ok: false, problem: "live_in_draft" } });
    expect(await hook.prepare!("p", [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_live_abc123" }])).toEqual({
      rejection: { environment: "draft", name: "STRIPE_SECRET_KEY", reason: "live_in_draft", message: stripeKeyMessage("live_in_draft", "draft") },
    });
    expect(stripeKeyMessage("live_in_draft", "draft")).toMatch(/test key/);
  });

  it("rejects a key of another account than the one saved for the other environment", async () => {
    const { hook, store } = setup({ sk_live_x: good("acct_2", true) });
    await store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_1", accountName: null, keyKind: "sk", chargesEnabled: null });
    expect(await hook.prepare!("p", [{ environment: "live", name: "STRIPE_SECRET_KEY", value: "sk_live_x" }])).toMatchObject({
      rejection: { environment: "live", name: "STRIPE_SECRET_KEY", reason: "other_account" },
    });
  });

  it("rejects two keys of different accounts saved together", async () => {
    const { hook } = setup({ sk_test_x: good("acct_1", false), sk_live_x: good("acct_2", true) });
    const r = await hook.prepare!("p", [
      { environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_x" },
      { environment: "live", name: "STRIPE_SECRET_KEY", value: "sk_live_x" },
    ]);
    expect(r).toMatchObject({ rejection: { reason: "other_account" } });
  });

  it("an unknown account never counts as another account", async () => {
    const { hook, store } = setup({ rk_live_x: good("unknown", true) });
    await store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_1", accountName: null, keyKind: "sk", chargesEnabled: null });
    expect(await hook.prepare!("p", [{ environment: "live", name: "STRIPE_SECRET_KEY", value: "rk_live_x" }])).not.toHaveProperty("rejection");
  });

  it("commit writes the account row", async () => {
    const { hook, store } = setup({ sk_test_x: good("acct_1", false) });
    const r = await hook.prepare!("p", [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_x" }]);
    expect(await store.getAccount("p", "draft")).toBeNull();
    if ("rejection" in r) throw new Error("rejected");
    await r.commit!();
    expect(await store.getAccount("p", "draft")).toMatchObject({ accountId: "acct_1", accountName: "Taller", keyKind: "rk", chargesEnabled: null });
  });

  it("an unverified key is saved and reported, and an old account row for it goes away", async () => {
    const { hook, store } = setup({ sk_test_x: { ok: "unverified", keyKind: "sk", livemode: false } });
    await store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_old", accountName: null, keyKind: "sk", chargesEnabled: null });
    const r = await hook.prepare!("p", [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_x" }]);
    if ("rejection" in r) throw new Error("rejected");
    expect(r.unverified).toEqual([{ environment: "draft", name: "STRIPE_SECRET_KEY" }]);
    await r.commit!();
    expect(await store.getAccount("p", "draft")).toBeNull();
  });
});

describe("stripeSecretHook.beforeUnset", () => {
  it("deletes the endpoints and the account row, and returns their secret names", async () => {
    const { hook, store, deleteEndpoints } = setup();
    await store.putAccount({ projectId: "p", environment: "draft", accountId: "acct_1", accountName: null, keyKind: "sk", chargesEnabled: null });
    expect(await hook.beforeUnset!("p", "draft", ["STRIPE_SECRET_KEY"])).toEqual(["STRIPE_WEBHOOK_SECRET"]);
    expect(deleteEndpoints).toHaveBeenCalledWith("p", "draft");
    expect(await store.getAccount("p", "draft")).toBeNull();
  });

  it("does nothing when the Stripe key is not among the names", async () => {
    const { hook, deleteEndpoints } = setup();
    expect(await hook.beforeUnset!("p", "draft", ["TOKEN"])).toEqual([]);
    expect(deleteEndpoints).not.toHaveBeenCalled();
  });

  it("a failure deleting the endpoints doesn't stop the unset", async () => {
    const { hook, deleteEndpoints } = setup();
    deleteEndpoints.mockRejectedValueOnce(new Error("stripe down"));
    expect(await hook.beforeUnset!("p", "live", ["STRIPE_SECRET_KEY"])).toEqual([]);
  });
});
