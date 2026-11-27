// @vitest-environment jsdom
//
// «PERMISOS» (spec local 2026-11-27-notificaciones-del-escritorio, §4.5, §7.2): what the app declared, each with its state and,
// for what can be granted, a switch; what a PWA can't have reads «Not available in the browser»; a browser that blocks
// OpenLen's notifications is explained, since only the person can lift that, in the browser. Like Claude's Permissions dialog it
// is MODAL with «Cancel» and «Save»: the switches change a draft, and nothing is stored until «Save».
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { windowMessages } from "@/lib/desktop-apps/window-messages";

import { PermissionsPanel, type PermissionsPanelProps } from "./permissions-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
let missing: string[] = [];
const onSave = vi.fn();
const onClose = vi.fn();

const BASE: PermissionsPanelProps = {
  appName: "Bookings",
  notificationsOn: true,
  rows: [
    { permission: "notifications", state: "prompt" },
    { permission: "shortcuts", state: "unavailable" },
  ],
  supported: true,
  browserBlocked: false,
  onSave,
  onClose,
};

async function render(over: Partial<PermissionsPanelProps> = {}) {
  const messages = await windowMessages("en", { tool: false });
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} onError={(e) => void missing.push(e.message)}>
        <PermissionsPanel {...BASE} {...over} />
      </NextIntlClientProvider>,
    );
  });
}
const panel = () => host.querySelector("[data-desktop-permissions]")!;
const toggle = () => host.querySelector<HTMLButtonElement>("[role=switch]");
const buttonOf = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);
async function flip() {
  await act(async () => toggle()!.click());
}
/** The person reads the panel first: «Save» ignores clicks for a moment after it shows (a click the app timed). */
async function clickSave(after = 600) {
  vi.setSystemTime(Date.now() + after);
  await act(async () => buttonOf("Save")!.click());
}
const escape = () => act(async () => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T09:00:00.000Z"));
  missing = [];
  onSave.mockClear();
  onClose.mockClear();
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

describe("PermissionsPanel", () => {
  it("lists declared with states: a switch for notifications, «Not available in the browser» for the rest", async () => {
    await render();
    expect(panel().textContent).toContain("Permissions for Bookings");
    expect(panel().textContent).toContain("Notifications");
    expect(panel().textContent).toContain("Keyboard shortcuts");
    expect(panel().textContent).toContain("Not available in the browser");
    expect(host.querySelectorAll("[role=switch]")).toHaveLength(1);
    expect(toggle()!.getAttribute("aria-checked")).toBe("false");
  });

  it("is modal over the window, with «Cancel» and «Save»", async () => {
    await render();
    expect(panel().getAttribute("aria-modal")).toBe("true");
    const backdrop = host.querySelector("[data-desktop-permissions-backdrop]")!;
    expect(backdrop.className).toContain("fixed");
    expect(backdrop.className).toContain("inset-0");
    expect(backdrop.contains(panel())).toBe(true);
    expect([...panel().querySelectorAll("button:not([role=switch])")].map((b) => b.textContent)).toEqual(["Cancel", "Save"]);
  });

  it("a switch changes only the draft; «Save» stores it and closes", async () => {
    await render();
    await flip();
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
    await clickSave();
    expect(onSave).toHaveBeenCalledWith([{ permission: "notifications", on: true }]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a granted one is on, and switching it off then «Save» says no", async () => {
    await render({ rows: [{ permission: "notifications", state: "granted" }] });
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    await flip();
    await clickSave();
    expect(onSave).toHaveBeenCalledWith([{ permission: "notifications", on: false }]);
  });

  it("switched and switched back is no change: «Save» stores nothing", async () => {
    await render();
    await flip();
    await flip();
    await clickSave();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a click on «Save» in the first 500 ms does nothing; after, it saves", async () => {
    await render();
    await flip();
    await clickSave(499);
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    await clickSave(2);
    expect(onSave).toHaveBeenCalledWith([{ permission: "notifications", on: true }]);
  });

  it("the guard starts again on every opening", async () => {
    await render();
    vi.setSystemTime(Date.now() + 5000);
    act(() => root!.unmount());
    root = createRoot(host);
    await render();
    await flip();
    await clickSave(100);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("«Cancel» and Escape discard the draft", async () => {
    await render();
    await flip();
    vi.setSystemTime(Date.now() + 600);
    await act(async () => buttonOf("Cancel")!.click());
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    await flip();
    await escape();
    expect(onSave).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("with OpenLen's dialog on top, Escape is not the panel's", async () => {
    await render({ covered: true });
    await escape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("browser-blocked explains how to re-enable", async () => {
    await render({ rows: [{ permission: "notifications", state: "denied" }], browserBlocked: true });
    expect(panel().textContent).toContain("Your browser is blocking notifications from OpenLen");
    expect(panel().textContent).toContain("allow notifications");
  });

  it("where the browser can't make notifications, they are not available either", async () => {
    await render({ supported: false, rows: [{ permission: "notifications", state: "unavailable" }] });
    expect(toggle()).toBeNull();
    expect(panel().textContent).toContain("Not available in the browser");
  });

  it("an app that declares nothing says so, with one «Close»", async () => {
    await render({ rows: [] });
    expect(panel().textContent).toContain("This app hasn’t asked for any permissions.");
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close"]);
  });

  it("with notifications off in OpenLen: only that line", async () => {
    await render({ notificationsOn: false });
    expect(panel().textContent).toContain("OpenLen has turned notifications from apps on the desktop off for now.");
    expect(toggle()).toBeNull();
    expect(panel().textContent).not.toContain("Keyboard shortcuts");
    expect([...panel().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Close"]);
  });

  it("with nothing to change, Close and Escape close it", async () => {
    await render({ rows: [] });
    await act(async () => buttonOf("Close")!.click());
    await escape();
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onSave).not.toHaveBeenCalled();
  });
});
