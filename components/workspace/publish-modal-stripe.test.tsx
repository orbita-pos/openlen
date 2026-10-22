// @vitest-environment jsdom
//
// STRIPE AFTER PUBLISHING (spec local 2026-10-21-stripe-integration, §6.4): the
// modal says what went to the owner's Stripe live mode and, if the account
// can't charge yet, where to finish it. It stays open so that can be read.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key),
  useLocale: () => "es",
}));

import { PublishModal } from "./publish-modal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function publish(stripe: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).endsWith("/publish")) return new Response(JSON.stringify({ subdomain: "caja", url: "https://caja.openlen.app", ...(stripe ? { stripe } : {}) }), { status: 200 });
      return new Response(JSON.stringify({ available: true }), { status: 200 });
    }),
  );
  const onClose = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <PublishModal open onClose={onClose} onSuccess={() => {}} project={{ id: "p1", subdomain: "caja", publishedAt: null, hasUnpublishedChanges: true, languages: ["en"] }} />,
    ),
  );
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("publish.primary."));
  await act(async () => button!.click());
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return { host, onClose };
}

const CREATED = { products: 1, prices: 1, paymentLinks: 1, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 1 };

describe("the publish modal and Stripe", () => {
  it("after publishing shows what was created in Stripe live, and stays open", async () => {
    const { host, onClose } = await publish({ created: CREATED, swaps: 1, chargesEnabled: true });
    const text = host.textContent ?? "";
    expect(text).toContain("publish.stripe.created");
    // The mock's JSON escapes the inner quotes of each kind's own `{count}`.
    for (const k of ["products", "prices", "paymentLinks", "webhookEndpoints"]) expect(text).toContain(`publish.stripe.kind.${k}{\\"count\\":1}`);
    expect(text).not.toContain("publish.stripe.kind.shippingRates");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("after publishing warns when the live account can't charge yet, with the link to finish it", async () => {
    const { host } = await publish({ created: CREATED, swaps: 1, chargesEnabled: false });
    expect(host.textContent).toContain("publish.stripe.cannotChargeYet");
    expect([...host.querySelectorAll("a")].map((a) => a.getAttribute("href"))).toContain("https://dashboard.stripe.com/account/onboarding");
  });

  it("nothing to say about Stripe → it closes as before", async () => {
    const { onClose } = await publish({ created: { products: 0, prices: 0, paymentLinks: 0, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 }, swaps: 0, chargesEnabled: true });
    expect(onClose).toHaveBeenCalled();
  });

  it("the two Stripe errors are said", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "stripe_account_mismatch" }), { status: 422 })));
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<PublishModal open onClose={() => {}} onSuccess={() => {}} project={{ id: "p1", subdomain: "caja", publishedAt: null, hasUnpublishedChanges: true, languages: ["en"] }} />));
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("publish.primary."));
    await act(async () => button!.click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(host.textContent).toContain("publish.stripe.accountMismatch");
  });
});
