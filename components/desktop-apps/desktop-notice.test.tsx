// @vitest-environment jsdom
//
// WHAT THE WINDOW SAYS WHEN THERE IS NO APP TO FRAME (spec local 2026-11-26-apps-en-el-escritorio, §4.6, §6): its own
// page with the workspace's tokens. Real texts.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import enWsChrome from "@/messages/en/wsChrome.json";
import esWsChrome from "@/messages/es/wsChrome.json";
import { DesktopNotice } from "./desktop-notice";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
});

async function render(props: Parameters<typeof DesktopNotice>[0], locale: "en" | "es" = "en") {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale={locale} messages={{ wsChrome: locale === "es" ? esWsChrome : enWsChrome }}>
        <DesktopNotice {...props} />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

describe("DesktopNotice — gone", () => {
  it("«{app} is no longer available», and how to uninstall it from the browser", async () => {
    const host = await render({ kind: "gone", name: "Bookings", locale: "en" });
    expect(host.textContent).toContain("Bookings is no longer available");
    expect(host.textContent).toContain("Uninstall");
    expect(host.textContent).toContain("chrome://apps");
    expect(host.querySelector("[data-desktop-notice]")?.getAttribute("data-desktop-notice")).toBe("gone");
    expect(host.querySelector("iframe")).toBeNull();
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/en");
  });

  it("🔴 with no name (an id that is not the person's) it says nothing about whose app it was", async () => {
    const host = await render({ kind: "gone", locale: "en" });
    expect(host.textContent).toContain("This app is no longer available");
    expect(host.textContent).not.toContain("{name}");
  });

  // Claude's «Can't open the app» says why. The reason is the person's own row's: with none, the page says nothing of it.
  it("says why when it is the person's own app: removed, or its tool switched off", async () => {
    let host = await render({ kind: "gone", name: "Bookings", reason: "removed", locale: "en" });
    expect(host.textContent).toContain("Bookings is no longer available");
    expect(host.textContent).toContain("It’s no longer on your desktop in OpenLen");
    expect(host.textContent).not.toContain("switched off");
    // …and still how to uninstall it from the browser: OpenLen can't remove a shortcut it didn't make.
    expect(host.textContent).toContain("chrome://apps");
    act(() => root!.unmount());

    host = await render({ kind: "gone", name: "Bookings", reason: "tool_off", locale: "en" });
    expect(host.textContent).toContain("This tool is switched off right now");
    expect(host.textContent).not.toContain("no longer on your desktop");
    expect(host.textContent).toContain("chrome://apps");
  });

  it("🔴 with no reason (an id that is not the person's, or nothing to say) it says nothing about why", async () => {
    const host = await render({ kind: "gone", locale: "en" });
    expect(host.textContent).not.toContain("no longer on your desktop");
    expect(host.textContent).not.toContain("switched off");
    expect(host.querySelectorAll("p")).toHaveLength(1);
  });

  it("speaks the person's language", async () => {
    const host = await render({ kind: "gone", name: "Reservas", locale: "es" }, "es");
    expect(host.textContent).toContain("Reservas ya no está disponible");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/es");
  });
});

describe("DesktopNotice — the workspace's tokens, light and dark", () => {
  it("both notices sit in `.workspace-v2`, whose dark values hang on `.dark` (set on <html> before the first paint by the layout)", async () => {
    for (const props of [{ kind: "gone", locale: "en" }, { kind: "plan_required", name: "Bookings", locale: "en" }] as const) {
      const host = await render(props);
      expect(host.firstElementChild?.classList.contains("workspace-v2")).toBe(true);
      act(() => root!.unmount());
    }
  });
});

describe("DesktopNotice — plan_required", () => {
  it("says a paid plan is needed, that nothing was deleted, and where the plans are", async () => {
    const host = await render({ kind: "plan_required", name: "Bookings", locale: "es" }, "es");
    expect(host.textContent).toContain("Bookings necesita un plan de pago");
    expect(host.textContent).toContain("No se borró nada");
    expect(host.querySelector("[data-desktop-notice]")?.getAttribute("data-desktop-notice")).toBe("plan_required");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/es/pricing");
    expect(host.querySelector("iframe")).toBeNull();
  });
});
