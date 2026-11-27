// @vitest-environment jsdom
//
// «PERMISOS» (spec local 2026-11-27-notificaciones-del-escritorio, §4.5, §7.2): what the app declared, each with its state and,
// for what can be granted, a switch; what a PWA can't have reads «Not available in the browser»; a browser that blocks
// OpenLen's notifications is explained, since only the person can lift that, in the browser.
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
const onToggle = vi.fn();
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
  onToggle,
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

beforeEach(() => {
  missing = [];
  onToggle.mockClear();
  onClose.mockClear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  expect(missing).toEqual([]);
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
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
    await act(async () => toggle()!.click());
    expect(onToggle).toHaveBeenCalledWith("notifications", true);
  });

  it("a granted one is on, and switching it off says no", async () => {
    await render({ rows: [{ permission: "notifications", state: "granted" }] });
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    await act(async () => toggle()!.click());
    expect(onToggle).toHaveBeenCalledWith("notifications", false);
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

  it("an app that declares nothing says so", async () => {
    await render({ rows: [] });
    expect(panel().textContent).toContain("This app hasn’t asked for any permissions.");
  });

  it("with notifications off in OpenLen: only that line", async () => {
    await render({ notificationsOn: false });
    expect(panel().textContent).toContain("OpenLen has turned notifications from apps on the desktop off for now.");
    expect(toggle()).toBeNull();
    expect(panel().textContent).not.toContain("Keyboard shortcuts");
  });

  it("Close and Escape close it", async () => {
    await render();
    const close = [...host.querySelectorAll("button")].find((b) => b.textContent === "Close")!;
    await act(async () => close.click());
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
