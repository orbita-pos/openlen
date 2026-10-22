import { describe, expect, it, vi } from "vitest";

import { FunctionSecretsMissingError } from "@/lib/functions/publish-errors";

import { previewStripeForPublish } from "./preview";
import { StripeAccountMismatchError } from "./publish-errors";

const plan = { create: { products: 1, prices: 1, paymentLinks: 0, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 }, swaps: 0, unknownRefs: [], chargesEnabled: true, needsWrites: true, droppedImages: 0 };

describe("previewStripeForPublish", () => {
  it("reads like an owner publish, with the project's texts and the live functions", async () => {
    const prepare = vi.fn(async () => ({ preview: { plan, accountName: "Taller" }, apply: vi.fn() }));
    const r = await previewStripeForPublish("p", ["pago"], { texts: async () => ["<a>"], prepare });
    expect(r).toEqual({ kind: "ok", preview: { plan, accountName: "Taller" } });
    expect(prepare).toHaveBeenCalledWith("p", { mode: "owner", skipMissingSecrets: false, texts: ["<a>"], liveFunctions: ["pago"] });
  });

  it("nothing of Stripe → none; a missing live key and two accounts are said apart", async () => {
    expect(await previewStripeForPublish("p", [], { texts: async () => [], prepare: async () => null })).toEqual({ kind: "none" });
    expect(await previewStripeForPublish("p", [], { texts: async () => [], prepare: async () => { throw new FunctionSecretsMissingError(["STRIPE_SECRET_KEY"]); } })).toEqual({ kind: "missing_live_key" });
    expect(await previewStripeForPublish("p", [], { texts: async () => [], prepare: async () => { throw new StripeAccountMismatchError(); } })).toEqual({ kind: "account_mismatch" });
  });

  it("anything else failing doesn't stop the card: none", async () => {
    expect(await previewStripeForPublish("p", [], { texts: async () => [], prepare: async () => { throw new Error("stripe down"); } })).toEqual({ kind: "none" });
  });
});
