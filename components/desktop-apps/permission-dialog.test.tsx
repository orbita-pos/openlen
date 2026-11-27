// @vitest-environment jsdom
//
// OPENLEN'S APPROVAL DIALOG (spec local 2026-11-27-notificaciones-del-escritorio, §4.3): Claude's copy, «Don't allow» the
// default and the cancel. Real texts, in English and Spanish.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { windowMessages } from "@/lib/desktop-apps/window-messages";

import { PermissionDialog } from "./permission-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
let missing: string[] = [];
const onAllow = vi.fn();
const onDeny = vi.fn();

async function render(locale: string, reask: boolean) {
  const messages = await windowMessages(locale, { tool: false });
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale={locale} messages={messages} onError={(e) => void missing.push(e.message)}>
        <PermissionDialog appName="Bookings" reask={reask} onAllow={onAllow} onDeny={onDeny} />
      </NextIntlClientProvider>,
    );
  });
}
const buttons = () => [...host.querySelectorAll("button")];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T09:00:00.000Z"));
  missing = [];
  onAllow.mockClear();
  onDeny.mockClear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  expect(missing).toEqual([]);
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("PermissionDialog", () => {
  it("says Claude's words, «Don't allow» first and focused", async () => {
    await render("en", false);
    const d = host.querySelector("[role=alertdialog]")!;
    expect(d.textContent).toContain("Allow Bookings to show notifications?");
    expect(d.textContent).toContain("It can show notifications while you use other apps. You can change this any time in Permissions.");
    expect(d.textContent).not.toContain("asking again");
    expect(buttons().map((b) => b.textContent)).toEqual(["Don’t allow", "Allow"]);
    expect(document.activeElement).toBe(buttons()[0]);
  });

  it("the Spanish copy is the spec's", async () => {
    await render("es", false);
    expect(host.textContent).toContain("¿Permitir que Bookings muestre notificaciones?");
    expect(host.textContent).toContain("Puede mostrar notificaciones mientras usas otras apps. Puedes cambiarlo cuando quieras en Permisos.");
    expect(buttons().map((b) => b.textContent)).toEqual(["No permitir", "Permitir"]);
  });

  it("asking again says why", async () => {
    await render("es", true);
    expect(host.textContent).toContain("¿Seguir permitiendo que Bookings muestre notificaciones?");
    expect(host.textContent).toContain("Esta app cambió desde que lo permitiste, así que volvemos a preguntar.");
  });

  it("a click on Allow in the first 500 ms does nothing", async () => {
    await render("en", false);
    vi.setSystemTime(Date.now() + 499);
    await act(async () => buttons()[1]!.click());
    expect(onAllow).not.toHaveBeenCalled();
  });

  it("a click after 500 ms grants; «Don't allow» is never held back", async () => {
    await render("en", false);
    await act(async () => buttons()[0]!.click());
    expect(onDeny).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 500);
    await act(async () => buttons()[1]!.click());
    expect(onAllow).toHaveBeenCalledTimes(1);
  });

  it("the buttons answer, and Escape is the cancel: «Don't allow»", async () => {
    await render("en", false);
    vi.setSystemTime(Date.now() + 600);
    await act(async () => buttons()[1]!.click());
    expect(onAllow).toHaveBeenCalledTimes(1);
    await act(async () => buttons()[0]!.click());
    expect(onDeny).toHaveBeenCalledTimes(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onDeny).toHaveBeenCalledTimes(2);
    expect(onAllow).toHaveBeenCalledTimes(1);
  });
});
