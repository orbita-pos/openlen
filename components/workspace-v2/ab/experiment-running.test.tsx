// The publish that would end a running A/B test (review items 13, 14): the owner is asked, in the Publish dialog and in
// Len's publish card, and «Stop and publish» sends the publish again with `stopActiveAb`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import en from "@/messages/en/modalsDeploy.json";
import es from "@/messages/es/modalsDeploy.json";

import { AbExperimentRunning } from "./experiment-running";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

async function mount(locale: "es" | "en", props: Partial<React.ComponentProps<typeof AbExperimentRunning>> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const p = { name: "Direct hero", busy: false, onStopAndPublish: vi.fn(), onCancel: vi.fn(), ...props };
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={{ modalsDeploy: locale === "es" ? es : en }}>
        <AbExperimentRunning {...p} />
      </NextIntlClientProvider>,
    );
  });
  return { host, p };
}
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("the A/B test that publishing would stop", () => {
  it("says what happens and names the test; «Stop and publish» asks to publish with it stopped", async () => {
    const { host, p } = await mount("en");
    expect(host.textContent).toContain("An A/B test is running on this page. Publishing stops it. Stop and publish?");
    expect(host.textContent).toContain("Direct hero");
    await act(async () => button(host, "Stop and publish").click());
    expect(p.onStopAndPublish).toHaveBeenCalledTimes(1);
    expect(p.onCancel).not.toHaveBeenCalled();
  });

  it("Cancel leaves everything as it was", async () => {
    const { host, p } = await mount("es");
    expect(host.textContent).toContain("Hay una prueba A/B en marcha");
    await act(async () => button(host, "Cancelar").click());
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(p.onStopAndPublish).not.toHaveBeenCalled();
  });

  it("while publishing, neither button can be pressed again", async () => {
    const { host } = await mount("en", { busy: true });
    expect(button(host, "Stop and publish").disabled).toBe(true);
    expect(button(host, "Cancel").disabled).toBe(true);
  });
});
