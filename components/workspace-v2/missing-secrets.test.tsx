// WHAT THE MISSING-SECRETS BOX SAYS (spec local 2026-10-21-stripe-integration, §6.4). A page
// with a payment link has no function that reads STRIPE_SECRET_KEY: publishing needs it to
// copy the Stripe objects to live mode, and without it the published page keeps the test
// ones. Found in the real test of 22/10, where the box said «your functions read them».
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { MissingSecretsView } from "./missing-secrets";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

const t = (key: string) => key;

function mount(missing: string[]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<MissingSecretsView projectId="p1" missing={missing} busy={false} onSavedPublish={() => {}} onPublishAnyway={() => {}} t={t} />));
  return host;
}

describe("MissingSecretsView", () => {
  it("only the Stripe key missing → says what it is for, not that functions read it", () => {
    const text = mount(["STRIPE_SECRET_KEY"]).textContent ?? "";
    expect(text).toContain("functionSecrets.stripe.missingHint");
    expect(text).not.toContain("functionSecrets.missingHint");
  });

  it("a function's secret missing → the functions' sentence (control arm)", () => {
    const text = mount(["RESEND_API_KEY", "STRIPE_SECRET_KEY"]).textContent ?? "";
    expect(text).toContain("functionSecrets.missingHint");
    expect(text).not.toContain("functionSecrets.stripe.missingHint");
  });
});
