// The publish that met a decision in progress (review: writers outside the claim): it says why and touches nothing; the outcome of
// the 409 is parsed by publish-request.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import en from "@/messages/en/modalsDeploy.json";
import es from "@/messages/es/modalsDeploy.json";
import { postPublish } from "@/lib/workspace-v2/publish-request";

import { AbDecisionInProgress } from "./decision-in-progress";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mount(locale: "en" | "es") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const onClose = vi.fn();
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{ modalsDeploy: locale === "es" ? es : en }}>
        <AbDecisionInProgress onClose={onClose} />
      </NextIntlClientProvider>,
    );
  });
  return { host, onClose };
}

describe("the publish that met a decision in progress", () => {
  it("says why, in the person's language, and the button closes it", async () => {
    const { host, onClose } = await mount("es");
    expect(host.textContent).toContain(es.abDecisionInProgress.title);
    expect(host.textContent).toContain(es.abDecisionInProgress.body);
    await act(async () => host.querySelector("button")!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    const english = await mount("en");
    expect(english.host.textContent).toContain(en.abDecisionInProgress.title);
  });

  it("🔴 the 409 ab_decision_in_progress is its own outcome (not a generic error)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "ab_decision_in_progress", experimentId: "ab_1", name: "Hero" }), { status: 409 })));
    expect(await postPublish("p1", {})).toEqual({ kind: "ab_decision_in_progress", experimentId: "ab_1", name: "Hero" });
  });
});
