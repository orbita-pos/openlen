// @vitest-environment jsdom
//
// THE WINDOW ANSWERS THE FRAME (spec local 2026-11-27-notificaciones-del-escritorio, §4.2–4.6, §7): the only real security
// boundary. A message counts only from the frame's own window AND its origin; every argument goes through the protocol's
// validators; the dialog is OpenLen's; the answers live on the device; the Notification is the window's.
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP_API_CHANNEL, type AppApiResponse } from "@/lib/desktop-apps/app-api/protocol";
import type { DesktopPermission } from "@/lib/desktop-apps/permissions/declared";
import { GRANTS_STORAGE_KEY, grantKey, localGrantStore } from "@/lib/desktop-apps/permissions/grants";
import { windowMessages } from "@/lib/desktop-apps/window-messages";

import { useAppApiHost, type AppApiHostInput } from "./use-app-api-host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ORIGIN = "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app";
const INSTALLED = "2026-11-20T12:00:00.000Z";
const KEY = grantKey("u1", "d1", "notifications");

class FakeNotification {
  static permission: NotificationPermission = "default";
  static answer: NotificationPermission = "granted";
  static requestPermission = vi.fn(async () => {
    FakeNotification.permission = FakeNotification.answer;
    return FakeNotification.answer;
  });
  static made: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  constructor(
    public title: string,
    public options: NotificationOptions,
  ) {
    FakeNotification.made.push(this);
  }
}

let root: Root | null = null;
let host: HTMLDivElement;
let visible = "visible";
let focused = true;
let messages: Record<string, unknown>;
let api: ReturnType<typeof useAppApiHost> | null = null;

function Harness(over: Partial<AppApiHostInput>) {
  const frame = useRef<HTMLIFrameElement>(null);
  api = useAppApiHost({
    frame,
    frameOrigin: ORIGIN,
    personId: "u1",
    installationId: "d1",
    releaseSha: "sha1",
    installedAt: INSTALLED,
    declared: ["notifications"],
    notificationsOn: true,
    appName: "Bookings",
    iconUrl: "/desktop/d1/icon",
    NotificationCtor: FakeNotification as unknown as typeof Notification,
    ...over,
  });
  return (
    <>
      <iframe ref={frame} title="app" data-app />
      <iframe title="other" data-other />
      {api.dialog}
    </>
  );
}

async function render(over: Partial<AppApiHostInput> = {}) {
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Harness {...over} />
      </NextIntlClientProvider>,
    );
  });
}

const appFrame = () => host.querySelector<HTMLIFrameElement>("[data-app]")!;
const otherFrame = () => host.querySelector<HTMLIFrameElement>("[data-other]")!;

/** What the window posted back to the app's frame. */
let replies: { message: AppApiResponse; target: string }[] = [];
function listen() {
  replies = [];
  vi.spyOn(appFrame().contentWindow!, "postMessage").mockImplementation(((message: AppApiResponse, target: string) => {
    replies.push({ message, target });
  }) as never);
}

let seq = 0;
async function send(method: string, args: unknown, o: { origin?: string; source?: Window | null; raw?: unknown } = {}) {
  const id = `req-${++seq}`;
  const data = o.raw ?? { channel: APP_API_CHANNEL, id, method, args };
  await act(async () => {
    window.dispatchEvent(new MessageEvent("message", { data, origin: o.origin ?? ORIGIN, source: o.source === undefined ? appFrame().contentWindow : o.source }));
  });
  await flush();
  return id;
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
const replyTo = (id: string) => replies.find((r) => r.message.id === id)?.message;
const dialog = () => host.querySelector("[data-desktop-permission-dialog]");
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);
const stored = () => localStorage.getItem(GRANTS_STORAGE_KEY);
/** The person reads the dialog first: «Allow» ignores clicks for a moment after it shows (a click the app timed). */
const later = (ms = 600) => vi.setSystemTime(Date.now() + ms);
async function clickAllow() {
  later();
  await act(async () => button("Allow")!.click());
}

async function setAttended(v: boolean) {
  visible = v ? "visible" : "hidden";
  focused = v;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
}

beforeEach(async () => {
  messages = await windowMessages("en", { tool: false });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-27T09:00:00.000Z"));
  localStorage.clear();
  visible = "visible";
  focused = true;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visible });
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
  FakeNotification.permission = "default";
  FakeNotification.answer = "granted";
  FakeNotification.requestPermission.mockClear();
  FakeNotification.made = [];
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await render();
  listen();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  api = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "userActivation");
});

describe("who may ask (Review Focus 1)", () => {
  it("a message from another origin or another source is ignored", async () => {
    // Right window, wrong origin; right origin, another frame; right origin, this window itself; another channel.
    await send("permissions.request", { names: ["notifications"] }, { origin: "https://evil.openlen.app" });
    await send("permissions.request", { names: ["notifications"] }, { source: otherFrame().contentWindow });
    await send("permissions.request", { names: ["notifications"] }, { source: window });
    await send("permissions.request", {}, { raw: { channel: "openlen-tool/1", id: "x", method: "permissions.request", args: {} } });
    await send("notification.show", { body: "hi" }, { origin: "https://evil.openlen.app" });
    expect(dialog()).toBeNull();
    expect(replies).toEqual([]);
    expect(FakeNotification.made).toEqual([]);
  });

  it("answers the frame's own window at the frame's origin, never «*»", async () => {
    const id = await send("permissions.state", { name: "notifications" });
    expect(replies).toEqual([{ message: { channel: APP_API_CHANNEL, id, ok: true, value: "prompt" }, target: ORIGIN }]);
  });

  it("arguments that don't fit are EINVAL", async () => {
    const a = await send("permissions.state", { name: "camera" });
    const b = await send("permissions.request", { names: "notifications" });
    expect(replyTo(a)).toMatchObject({ ok: false, code: "EINVAL" });
    expect(replyTo(b)).toMatchObject({ ok: false, code: "EINVAL" });
  });
});

describe("state", () => {
  it("state of an undeclared permission is unavailable", async () => {
    await render({ declared: [] });
    const id = await send("permissions.state", { name: "notifications" });
    expect(replyTo(id)).toMatchObject({ ok: true, value: "unavailable" });
  });

  it("state() is the whole map", async () => {
    const id = await send("permissions.state", undefined);
    expect(replyTo(id)).toMatchObject({
      ok: true,
      value: { notifications: "prompt", shortcuts: "unavailable", overlay: "unavailable", "menu-bar": "unavailable", "full-access": "unavailable" },
    });
  });

  it("switch off → every state unavailable", async () => {
    localGrantStore().set(KEY, { answer: "granted", releaseSha: "sha1", installedAt: INSTALLED });
    FakeNotification.permission = "granted";
    await render({ notificationsOn: false });
    const id = await send("permissions.state", undefined);
    const value = (replyTo(id) as { value: Record<DesktopPermission, string> }).value;
    expect(Object.values(value)).toEqual(["unavailable", "unavailable", "unavailable", "unavailable", "unavailable"]);
    const r = await send("permissions.request", undefined);
    expect(dialog()).toBeNull();
    expect(replyTo(r)).toMatchObject({ ok: true });
  });

  it("no Notification constructor → unavailable", async () => {
    vi.stubGlobal("Notification", undefined);
    await render({ NotificationCtor: undefined });
    const id = await send("permissions.state", { name: "notifications" });
    expect(replyTo(id)).toMatchObject({ ok: true, value: "unavailable" });
    const r = await send("permissions.request", undefined);
    expect(dialog()).toBeNull();
    expect(replyTo(r)).toMatchObject({ ok: true });
  });
});

describe("request", () => {
  it("request opens the dialog only when visible and focused", async () => {
    await setAttended(false);
    const id = await send("permissions.request", { names: ["notifications"] });
    expect(dialog()).toBeNull();
    expect(replyTo(id)).toBeUndefined();
    visible = "visible";
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(dialog()).toBeNull(); // visible, not focused yet
    await setAttended(true);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("Allow Bookings to show notifications?");
  });

  it("Allow saves granted with releaseSha and installedAt and asks the browser", async () => {
    const id = await send("permissions.request", { names: ["notifications"] });
    await clickAllow();
    await flush();
    expect(localGrantStore().get(KEY)).toEqual({ answer: "granted", releaseSha: "sha1", installedAt: INSTALLED });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(replyTo(id)).toMatchObject({ ok: true, value: { notifications: "granted" } });
  });

  it("Don't allow saves denied forever", async () => {
    const id = await send("permissions.request", undefined);
    await act(async () => button("Don’t allow")!.click());
    await flush();
    expect(localGrantStore().get(KEY)).toEqual({ answer: "denied" });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(replyTo(id)).toMatchObject({ ok: true, value: { notifications: "denied" } });
    // A new version asks nothing: a «no» is for good.
    await render({ releaseSha: "sha2" });
    const again = await send("permissions.request", undefined);
    expect(dialog()).toBeNull();
    expect(replyTo(again)).toMatchObject({ ok: true, value: { notifications: "denied" } });
  });

  it("a click on Allow in the first 500 ms does nothing", async () => {
    await send("permissions.request", undefined);
    later(499);
    await act(async () => button("Allow")!.click());
    expect(dialog()).not.toBeNull();
    expect(stored()).toBeNull();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("a click after 500 ms grants", async () => {
    await send("permissions.request", undefined);
    later(499);
    await act(async () => button("Allow")!.click());
    later(2);
    await act(async () => button("Allow")!.click());
    expect(localGrantStore().get(KEY)).toMatchObject({ answer: "granted" });
  });

  it("the guard starts again for every dialog that shows", async () => {
    await send("permissions.request", undefined);
    await act(async () => button("Don’t allow")!.click());
    // A «no» is for good, so the next one to ask needs a fresh permission: a re-asked «yes» of another version.
    localStorage.clear();
    localGrantStore().set(KEY, { answer: "granted", releaseSha: "old", installedAt: INSTALLED });
    await send("permissions.request", undefined);
    await act(async () => button("Allow")!.click());
    expect(localGrantStore().get(KEY)).toMatchObject({ releaseSha: "old" });
  });

  it("while the browser's own prompt is up, the dialog does not come back", async () => {
    let answer: (p: NotificationPermission) => void = () => {};
    FakeNotification.requestPermission.mockImplementationOnce(() => new Promise<NotificationPermission>((r) => (answer = r)));
    const id = await send("permissions.request", undefined);
    await clickAllow();
    // The browser's prompt takes the focus away and gives it back.
    await setAttended(false);
    await setAttended(true);
    expect(dialog()).toBeNull();
    FakeNotification.permission = "granted";
    await act(async () => answer("granted"));
    await flush();
    expect(dialog()).toBeNull();
    expect(replyTo(id)).toMatchObject({ ok: true, value: { notifications: "granted" } });
  });

  it("Escape with Permissions and the dialog open answers only the dialog", async () => {
    await act(async () => api!.openPermissions());
    await send("permissions.request", undefined);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(localGrantStore().get(KEY)).toEqual({ answer: "denied" });
    expect(dialog()).toBeNull();
    expect(host.querySelector("[data-desktop-permissions]")).not.toBeNull();
    // Now on top, the panel closes on the next Escape.
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(host.querySelector("[data-desktop-permissions]")).toBeNull();
  });

  it("Escape is «Don't allow»", async () => {
    await send("permissions.request", undefined);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(localGrantStore().get(KEY)).toEqual({ answer: "denied" });
  });

  it("closing without answering saves nothing", async () => {
    const id = await send("permissions.request", undefined);
    expect(dialog()).not.toBeNull();
    await setAttended(false);
    expect(dialog()).toBeNull();
    expect(stored()).toBeNull();
    expect(replyTo(id)).toBeUndefined();
    // Back in front, it asks again (the request is still alive).
    await setAttended(true);
    expect(dialog()).not.toBeNull();
  });

  it("a permission already answered is not asked again", async () => {
    localGrantStore().set(KEY, { answer: "granted", releaseSha: "sha1", installedAt: INSTALLED });
    FakeNotification.permission = "granted";
    const id = await send("permissions.request", undefined);
    expect(dialog()).toBeNull();
    expect(replyTo(id)).toMatchObject({ ok: true, value: { notifications: "granted" } });
  });

  it("one dialog at a time: a second request waits, and is answered by the first answer", async () => {
    const a = await send("permissions.request", undefined);
    const b = await send("permissions.request", undefined);
    expect(host.querySelectorAll("[data-desktop-permission-dialog]")).toHaveLength(1);
    await clickAllow();
    await flush();
    expect(dialog()).toBeNull();
    expect(replyTo(a)).toMatchObject({ ok: true, value: { notifications: "granted" } });
    expect(replyTo(b)).toMatchObject({ ok: true, value: { notifications: "granted" } });
  });

  it("at most 8 requests wait behind the open dialog; more are EPERM", async () => {
    await send("permissions.request", undefined);
    const waiting: string[] = [];
    for (let i = 0; i < 8; i++) waiting.push(await send("permissions.request", undefined));
    const over = await send("permissions.request", undefined);
    expect(replyTo(over)).toMatchObject({ ok: false, code: "EPERM", message: "too many pending requests" });
    for (const id of waiting) expect(replyTo(id)).toBeUndefined();
  });

  it("after an in-window update the old yes is a re-ask with the re-ask copy (Review Focus 3)", async () => {
    localGrantStore().set(KEY, { answer: "granted", releaseSha: "sha1", installedAt: INSTALLED });
    FakeNotification.permission = "granted";
    await render({ releaseSha: "sha2" });
    const s = await send("permissions.state", { name: "notifications" });
    expect(replyTo(s)).toMatchObject({ value: "prompt" });
    await send("permissions.request", undefined);
    expect(dialog()!.textContent).toContain("Keep allowing Bookings to show notifications?");
    expect(dialog()!.textContent).toContain("This app changed since you allowed it, so we’re asking again.");
    await clickAllow();
    await flush();
    expect(localGrantStore().get(KEY)).toEqual({ answer: "granted", releaseSha: "sha2", installedAt: INSTALLED });
  });

  it("an update while the dialog is open closes it without saving and answers the waiting request", async () => {
    const id = await send("permissions.request", undefined);
    await render({ releaseSha: "sha2" });
    await flush();
    expect(dialog()).toBeNull();
    expect(stored()).toBeNull();
    expect(replyTo(id)).toMatchObject({ ok: true, value: { notifications: "prompt" } });
  });
});

describe("the browser said no (Review Focus 2)", () => {
  it("browser denied after OpenLen yes → state denied, show EPERM, store unchanged", async () => {
    localGrantStore().set(KEY, { answer: "granted", releaseSha: "sha1", installedAt: INSTALLED });
    FakeNotification.permission = "denied";
    const before = stored();
    const s = await send("permissions.state", { name: "notifications" });
    const show = await send("notification.show", { body: "hi" });
    const r = await send("permissions.request", undefined);
    expect(replyTo(s)).toMatchObject({ ok: true, value: "denied" });
    expect(replyTo(show)).toMatchObject({ ok: false, code: "EPERM" });
    expect(replyTo(r)).toMatchObject({ ok: true, value: { notifications: "denied" } });
    expect(dialog()).toBeNull();
    expect(FakeNotification.made).toEqual([]);
    expect(stored()).toBe(before);
  });
});

describe("show", () => {
  beforeEach(() => {
    localGrantStore().set(KEY, { answer: "granted", releaseSha: "sha1", installedAt: INSTALLED });
    FakeNotification.permission = "granted";
  });

  it("show creates one Notification with the app name, icon and tag; click focuses the window", async () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => {});
    const id = await send("notification.show", { body: "Your booking is confirmed" });
    expect(replyTo(id)).toEqual({ channel: APP_API_CHANNEL, id, ok: true, value: undefined });
    expect(FakeNotification.made).toHaveLength(1);
    const n = FakeNotification.made[0]!;
    expect(n.title).toBe("Bookings");
    expect(n.options).toEqual({ body: "Your booking is confirmed", icon: "/desktop/d1/icon", tag: "d1" });
    n.onclick!();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("show with an extra key → EINVAL", async () => {
    const id = await send("notification.show", { body: "x", title: "Mine" });
    expect(replyTo(id)).toMatchObject({ ok: false, code: "EINVAL" });
    expect(FakeNotification.made).toEqual([]);
  });

  it("without a yes it is EPERM and never asks the browser", async () => {
    localStorage.clear();
    const id = await send("notification.show", { body: "x" });
    expect(replyTo(id)).toMatchObject({ ok: false, code: "EPERM" });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("at most one a second: the rest are EPERM", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-27T10:00:00.000Z"));
    const a = await send("notification.show", { body: "1" });
    const b = await send("notification.show", { body: "2" });
    vi.setSystemTime(new Date("2026-11-27T10:00:01.100Z"));
    const c = await send("notification.show", { body: "3" });
    expect(replyTo(a)).toMatchObject({ ok: true });
    expect(replyTo(b)).toMatchObject({ ok: false, code: "EPERM" });
    expect(replyTo(c)).toMatchObject({ ok: true });
    expect(FakeNotification.made).toHaveLength(2);
  });
});

describe("manage", () => {
  const activation = (isActive: boolean) => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive, hasBeenActive: isActive } });

  it("without a gesture in the window it is EPERM and opens nothing", async () => {
    activation(false);
    const id = await send("permissions.manage", undefined);
    expect(replyTo(id)).toMatchObject({ ok: false, code: "EPERM" });
    expect(host.querySelector("[data-desktop-permissions]")).toBeNull();
  });

  it("hidden, it is ENOTSUP", async () => {
    activation(true);
    visible = "hidden";
    const id = await send("permissions.manage", undefined);
    expect(replyTo(id)).toMatchObject({ ok: false, code: "ENOTSUP" });
  });

  it("with a gesture and visible, it opens Permissions", async () => {
    activation(true);
    const id = await send("permissions.manage", undefined);
    expect(replyTo(id)).toEqual({ channel: APP_API_CHANNEL, id, ok: true, value: undefined });
    expect(host.querySelector("[data-desktop-permissions]")).not.toBeNull();
  });

  it("openPermissions opens it from the window", async () => {
    await act(async () => api!.openPermissions());
    expect(host.querySelector("[data-desktop-permissions]")).not.toBeNull();
  });
});
