// @vitest-environment jsdom
//
// THE WINDOW OF AN APP ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §4.3): the frozen release full screen,
// OpenLen's thin strip, and — outside the installed window — the «Instalar» card. Real texts, in English.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  create: vi.fn((_options: unknown) => ({ onMessage: vi.fn(async () => {}), notifyContext: vi.fn(), notifyData: vi.fn() })),
}));
vi.mock("@/lib/tools/bridge/host", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tools/bridge/host")>()),
  createToolBridgeHost: bridge.create,
}));

import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";
import { EARLY_INSTALL_PROMPT_SCRIPT } from "@/lib/desktop-apps/early-install-prompt";
import { windowMessages } from "@/lib/desktop-apps/window-messages";
import { DesktopWindow, type DesktopWindowProps } from "./desktop-window";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP: DesktopWindowProps = {
  desktopId: "d1",
  name: "Bookings",
  frameUrl: "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app/?v=sha1",
  frameOrigin: "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app",
  projectId: "p1",
  releaseSha: "sha1",
  toolInstallationId: null,
  installedAt: "2026-11-20T12:00:00.000Z",
  locale: "en",
  personName: "Ana",
  personId: "u1",
  declaredPermissions: ["notifications"],
  manifestWarning: null,
  notificationsOn: true,
};

let root: Root | null = null;
let host: HTMLDivElement;

function stubDisplayMode(standalone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: standalone && query === "(display-mode: standalone)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

/** Every message next-intl could not find (it falls back to the key's path and tells `onError`). */
let missing: string[] = [];

/** The window inside the provider the PAGE builds: exactly the texts it sends to the browser, no more (the workspace's whole
 *  `wsChrome` is never there). */
async function render(over: Partial<DesktopWindowProps> = {}) {
  const props = { ...APP, ...over };
  const messages = await windowMessages("en", { tool: props.toolInstallationId !== null });
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={messages} onError={(e) => void missing.push(e.message)}>
        <DesktopWindow {...props} />
      </NextIntlClientProvider>,
    );
  });
}

type InstallEvent = Event & { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
function installEvent(outcome: "accepted" | "dismissed" = "accepted"): InstallEvent {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as InstallEvent;
  e.prompt = vi.fn(async () => {});
  e.userChoice = Promise.resolve({ outcome });
  return e;
}
const card = () => host.querySelector("[data-desktop-install]");
const buttons = () => [...host.querySelectorAll("button")];
const button = (text: string) => buttons().find((b) => b.textContent === text);

beforeEach(() => {
  missing = [];
  localStorage.clear();
  vi.useFakeTimers();
  stubDisplayMode(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 })));
  bridge.create.mockClear();
  delete (window as unknown as Record<string, unknown>).__openlenInstallPrompt;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  // Whatever a test showed, every text it needed was in what the page sends.
  expect(missing).toEqual([]);
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the frame", () => {
  it("is the frozen release on its private host, isolated like the canvas, full screen", async () => {
    await render();
    const frame = host.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe(APP.frameUrl);
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("title")).toBe("Bookings");
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
  });

  it("no bridge host for a plain app", async () => {
    await render({ toolInstallationId: null });
    expect(bridge.create).not.toHaveBeenCalled();
  });

  it("bridge host for a tool: its installation is the caller, the frame's origin is the only one it answers, and the workspace's colours are its theme", async () => {
    await render({ toolInstallationId: "ti1" });
    expect(bridge.create).toHaveBeenCalledTimes(1);
    const options = bridge.create.mock.calls[0]![0] as {
      caller: unknown;
      frameOrigin: string;
      theme(): { mode: string; tokens: Record<string, string> };
      context(): unknown;
      onPrompt: unknown;
    };
    expect(options.caller).toEqual({ installationId: "ti1" });
    expect(options.frameOrigin).toBe(APP.frameOrigin);
    expect(options.theme()).toEqual({ mode: "light", tokens: WORKSPACE_TOOL_THEME.light });
    // No chat to write in: `sendPrompt` answers «unavailable».
    expect(options.onPrompt).toBeNull();
    expect(options.context()).toEqual({ person: { name: "Ana", locale: "en" }, project: null, tool: { id: "ti1", version: "sha1" }, environment: "installed" });
  });

  it("a tool in a dark window is given the dark tokens", async () => {
    document.documentElement.classList.add("dark");
    try {
      await render({ toolInstallationId: "ti1" });
      const options = bridge.create.mock.calls[0]![0] as { theme(): { mode: string; tokens: Record<string, string> } };
      expect(options.theme()).toEqual({ mode: "dark", tokens: WORKSPACE_TOOL_THEME.dark });
    } finally {
      document.documentElement.classList.remove("dark");
    }
  });
});

describe("the strip", () => {
  it("is thin, names the app, and leaves a place for the new-version notice", async () => {
    await render();
    const strip = host.querySelector("[data-desktop-strip]")!;
    expect(strip.textContent).toContain("Bookings");
    expect(strip.querySelector("[data-desktop-notice-slot]")).not.toBeNull();
  });

  it("«About» says what the app is, who made it, when it was installed, and opens it in OpenLen", async () => {
    await render({ locale: "es" });
    expect(host.querySelector("[data-desktop-about]")).toBeNull();
    await act(async () => button("About")!.click());
    const about = host.querySelector("[data-desktop-about]")!;
    expect(about.textContent).toContain("Bookings");
    expect(about.textContent).toContain("Made by you, in OpenLen");
    expect(about.textContent).toMatch(/Installed on .*2026/);
    const link = about.querySelector("a")!;
    expect(link.textContent).toBe("Open in OpenLen");
    expect(link.getAttribute("href")).toBe("/es/new?project=p1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    await act(async () => button("Close")!.click());
    expect(host.querySelector("[data-desktop-about]")).toBeNull();
  });
});

describe("permissions and notifications (spec local 2026-11-27-notificaciones-del-escritorio)", () => {
  const ORIGIN = APP.frameOrigin;
  class FakeNotification {
    static permission: NotificationPermission = "granted";
    static requestPermission = vi.fn(async () => "granted" as NotificationPermission);
    constructor(
      public title: string,
      public options: NotificationOptions,
    ) {}
  }
  beforeEach(() => {
    vi.stubGlobal("Notification", FakeNotification);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    vi.spyOn(document, "hasFocus").mockImplementation(() => true);
  });
  afterEach(() => {
    delete (document as unknown as Record<string, unknown>).visibilityState;
    vi.restoreAllMocks();
  });
  const frame = () => host.querySelector("iframe")!;
  const ask = (method: string, args: unknown, source: Window | null = frame().contentWindow) =>
    act(async () => {
      window.dispatchEvent(new MessageEvent("message", { data: { channel: "openlen-app/1", id: "r1", method, args }, origin: ORIGIN, source }));
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  const dialog = () => host.querySelector("[data-desktop-permission-dialog]");

  it("«Permissions» in the strip opens the panel, next to «About»", async () => {
    await render();
    const strip = host.querySelector("[data-desktop-strip]")!;
    const labels = [...strip.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.slice(-2)).toEqual(["Permissions", "About"]);
    expect(host.querySelector("[data-desktop-permissions]")).toBeNull();
    await act(async () => button("Permissions")!.click());
    const panel = host.querySelector("[data-desktop-permissions]")!;
    expect(panel.textContent).toContain("Permissions for Bookings");
    expect(panel.textContent).toContain("Notifications");
  });

  it("the app's frame asks and the window draws OpenLen's dialog", async () => {
    await render();
    await ask("permissions.request", { names: ["notifications"] });
    expect(dialog()!.textContent).toContain("Allow Bookings to show notifications?");
  });

  it("a tool's frame asks through the same window", async () => {
    await render({ toolInstallationId: "ti1" });
    await ask("permissions.request", undefined);
    expect(dialog()).not.toBeNull();
  });

  it("a message from anything but the frame draws nothing", async () => {
    await render();
    await ask("permissions.request", undefined, window);
    expect(dialog()).toBeNull();
  });

  it("the manifest's warning goes to the console once, never on screen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await render({ manifestWarning: "The openlen-app-manifest tag is not valid JSON." });
    await render({ manifestWarning: "The openlen-app-manifest tag is not valid JSON.", name: "Bookings" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0])).toContain("not valid JSON");
    expect(host.textContent).not.toContain("not valid JSON");
  });

  it("after an in-window update, an old yes is asked again (Review Focus 3)", async () => {
    vi.useRealTimers();
    localStorage.setItem(
      "openlen:desktop-permissions",
      JSON.stringify({ "u1|d1|notifications": { answer: "granted", releaseSha: "sha1", installedAt: APP.installedAt } }),
    );
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: unknown, init?: RequestInit) =>
        init?.method === "POST"
          ? json({ desktopApp: { id: "d1", url: "/desktop/d1", name: "Bookings", releaseSha: "sha2", installedAt: APP.installedAt }, published: false })
          : json({ desktopApp: { id: "d1", releaseSha: "sha1" }, updateAvailable: true, published: false }),
      ),
    );
    await render();
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    await act(async () => button("Update")!.click());
    await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
    expect(frame().getAttribute("src")).toContain("v=sha2");
    await ask("permissions.request", undefined);
    expect(dialog()!.textContent).toContain("Keep allowing Bookings to show notifications?");
  });
});

describe("the install card", () => {
  it("install card shows when not standalone and prompt fires", async () => {
    await render();
    // Nothing yet: the browser may still be about to offer.
    expect(card()).toBeNull();
    const e = installEvent();
    await act(async () => void window.dispatchEvent(e));
    expect(e.defaultPrevented).toBe(true);
    expect(card()?.getAttribute("data-desktop-install")).toBe("prompt");
    expect(card()!.textContent).toContain("Install Bookings");
    await act(async () => button("Install")!.click());
    expect(e.prompt).toHaveBeenCalledTimes(1);
    // Once the person answered the browser's own dialog, the card has nothing left to say.
    expect(card()).toBeNull();
  });

  it("a prompt that fired before the page hydrated is not lost", async () => {
    const e = installEvent();
    (window as unknown as Record<string, unknown>).__openlenInstallPrompt = e;
    await render();
    expect(card()?.getAttribute("data-desktop-install")).toBe("prompt");
    await act(async () => button("Install")!.click());
    expect(e.prompt).toHaveBeenCalledTimes(1);
  });

  it("the early script keeps the event for the page", () => {
    const added: Array<[string, EventListenerOrEventListenerObject]> = [];
    const add = vi.spyOn(window, "addEventListener").mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
      added.push([type, listener]);
    });
    new Function(EARLY_INSTALL_PROMPT_SCRIPT)();
    add.mockRestore();
    expect(added.map(([type]) => type)).toEqual(["beforeinstallprompt"]);
    const e = installEvent();
    (added[0]![1] as (e: Event) => void)(e);
    expect(e.defaultPrevented).toBe(true);
    expect((window as unknown as Record<string, unknown>).__openlenInstallPrompt).toBe(e);
  });

  it("without the event the card says how to install it in that browser (and offers no button)", async () => {
    await render();
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(card()?.getAttribute("data-desktop-install")).toBe("manual");
    expect(card()!.textContent).toContain("Chrome or Edge");
    expect(button("Install")).toBeUndefined();
  });

  it("an event that comes after the browser's text is up turns it into the button", async () => {
    await render();
    await act(async () => void vi.advanceTimersByTime(3000));
    await act(async () => void window.dispatchEvent(installEvent()));
    expect(card()?.getAttribute("data-desktop-install")).toBe("prompt");
  });

  it("no card in the installed window, event or not", async () => {
    stubDisplayMode(true);
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(card()).toBeNull();
  });

  /** A new visit to the window: the page is gone and comes back, with the browser's offer to install it again. */
  async function visitAgain(over: Partial<DesktopWindowProps> = {}) {
    await act(async () => root!.unmount());
    root = createRoot(host);
    delete (window as unknown as Record<string, unknown>).__openlenInstallPrompt;
    await render(over);
    await act(async () => void window.dispatchEvent(installEvent()));
  }

  it("«Not now» closes the card, for the rest of this visit too", async () => {
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    await act(async () => button("Not now")!.click());
    expect(card()).toBeNull();
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(card()).toBeNull();
    // Not even if the browser offers again.
    await act(async () => void window.dispatchEvent(installEvent()));
    expect(card()).toBeNull();
  });

  it("🔴 «Not now» is remembered for that app in this browser: the next visit does not ask again", async () => {
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    await act(async () => button("Not now")!.click());
    expect(localStorage.getItem("openlen:desktop-install-later:d1")).toBe("1");

    await visitAgain();
    expect(card()).toBeNull();
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(card()).toBeNull();
  });

  it("it is remembered per app: another app's card still asks", async () => {
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    await act(async () => button("Not now")!.click());

    await visitAgain({ desktopId: "d2" });
    expect(card()).not.toBeNull();
    expect(card()!.textContent).toContain("Install Bookings");
  });

  it("🔴 without storage the page still works: «Not now» closes it for this visit, and it may ask again on the next", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      await render();
      await act(async () => void window.dispatchEvent(installEvent()));
      expect(card()).not.toBeNull();
      await act(async () => button("Not now")!.click());
      expect(card()).toBeNull();

      await visitAgain();
      expect(card()).not.toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("a finished install closes the card too", async () => {
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    expect(card()).not.toBeNull();
    await act(async () => void window.dispatchEvent(new Event("appinstalled")));
    expect(card()).toBeNull();
  });

  // M10 — Claude says exactly where the app went; a browser draws its own shortcut, so the steps are the browser's.
  describe("how to install it by hand, per browser", () => {
    const UAS = {
      chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.56",
      safari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
      firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
    } as const;
    const original = navigator.userAgent;
    const as = (userAgent: string) => Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => userAgent });
    afterEach(() => void Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => original }));

    async function manual() {
      await render();
      await act(async () => void vi.advanceTimersByTime(3000));
      expect(card()?.getAttribute("data-desktop-install")).toBe("manual");
      expect(button("Install")).toBeUndefined();
      return card()!.textContent!;
    }

    it("Chrome: the icon in the address bar, or its menu", async () => {
      as(UAS.chrome);
      const text = await manual();
      expect(text).toContain("In Chrome, click the install icon");
      expect(text).toContain("Install page as app");
      expect(text).not.toContain("Firefox");
    });

    it("Edge: the icon in the address bar, or Apps in its menu", async () => {
      as(UAS.edge);
      const text = await manual();
      expect(text).toContain("In Edge, click the install icon");
      expect(text).toContain("Install this site as an app");
    });

    it("Safari on a Mac: Add to Dock", async () => {
      as(UAS.safari);
      const text = await manual();
      expect(text).toContain("Safari");
      expect(text).toContain("Add to Dock");
    });

    it("Firefox can't install an app on a computer: it says to open it in Chrome or Edge", async () => {
      as(UAS.firefox);
      const text = await manual();
      expect(text).toContain("Firefox can’t install apps on a computer");
      expect(text).toContain("Chrome or Edge");
      expect(text).not.toContain("install icon");
    });

    it("a browser it can't tell gets the ways of the others, and never says Safari can't (it can: Add to Dock)", async () => {
      as("Lynx/2.9.0");
      const text = await manual();
      expect(text).toContain("Your browser didn’t offer to install it from here");
      expect(text).toContain("In Safari on a Mac, choose File → “Add to Dock…”");
      expect(text).toContain("Firefox can’t install apps on a computer");
      expect(text).not.toContain("Safari can’t install");
    });

    it("when the browser did offer, there are no steps to read: the button is all there is", async () => {
      as(UAS.firefox);
      await render();
      await act(async () => void window.dispatchEvent(installEvent()));
      expect(card()?.getAttribute("data-desktop-install")).toBe("prompt");
      expect(card()!.textContent).not.toContain("Firefox");
    });
  });
});

describe("the new-version notice (spec §4.4)", () => {
  const API = "/api/projects/p1/desktop";
  const FRAME_SHA2 = "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app/?v=sha2";
  const slot = () => host.querySelector("[data-desktop-notice-slot]")!;
  const frame = () => host.querySelector("iframe")!;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const state = (updateAvailable: boolean) => json({ desktopApp: { id: "d1", releaseSha: "sha1" }, updateAvailable, published: false });
  const installed = (releaseSha: string) =>
    json({ desktopApp: { id: "d1", url: "/desktop/d1", name: "Bookings", releaseSha, installedAt: "2026-11-20T12:00:00.000Z" }, published: false });

  type Handlers = { get?: () => Response | Promise<Response>; post?: () => Response | Promise<Response> };
  /** The desktop route and nothing else is answered here; every call to it is kept. Whatever else the window asks (a tool's
   *  jobs) is answered as in the other tests. */
  function stubApi(handlers: Handlers) {
    const calls: Array<{ method: string; body: string | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown, init?: RequestInit) => {
        if (String(input) !== API) return json({ jobs: [] });
        const method = init?.method ?? "GET";
        calls.push({ method, body: typeof init?.body === "string" ? init.body : undefined });
        return (method === "POST" ? handlers.post?.() : handlers.get?.()) ?? json({}, 500);
      }),
    );
    return calls;
  }
  const gets = (calls: Array<{ method: string }>) => calls.filter((c) => c.method === "GET").length;
  const posts = (calls: Array<{ method: string }>) => calls.filter((c) => c.method === "POST");
  async function settle() {
    await act(async () => void (await vi.advanceTimersByTimeAsync(0)));
  }
  /** The window is looked at again at least a minute after the last question: only then does it ask again (Claude's probe). */
  const aMinuteLater = () => act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
  function setVisibility(visibility: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  afterEach(() => void delete (document as unknown as Record<string, unknown>).visibilityState);

  it("asks GET on mount and on visibilitychange to visible, never on an interval", async () => {
    const calls = stubApi({ get: () => state(false) });
    await render();
    await settle();
    expect(gets(calls)).toBe(1);
    expect(calls[0]).toEqual({ method: "GET", body: undefined });

    // Leaving the window asks nothing; coming back does — once a minute has gone by since the last question. Coming back
    // inside that minute is not forgotten: it is asked when the minute ends (once), not before.
    await act(async () => void setVisibility("hidden"));
    await settle();
    expect(gets(calls)).toBe(1);
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(gets(calls)).toBe(1);
    await aMinuteLater();
    expect(gets(calls)).toBe(2);

    // And no clock asks: half an hour goes by.
    await act(async () => void (await vi.advanceTimersByTimeAsync(30 * 60 * 1000)));
    expect(gets(calls)).toBe(2);
    expect(posts(calls)).toHaveLength(0);

    // Looked at again after that, it goes out at once.
    await act(async () => void setVisibility("hidden"));
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(gets(calls)).toBe(3);

    // A closed window asks nothing more, not even what a look inside the minute had deferred.
    await act(async () => void setVisibility("hidden"));
    await act(async () => void setVisibility("visible"));
    await act(async () => root!.unmount());
    root = createRoot(host);
    await act(async () => void setVisibility("visible"));
    await aMinuteLater();
    expect(gets(calls)).toBe(3);
  });

  it("updateAvailable shows the strip with Actualizar — and nothing changes on its own", async () => {
    const calls = stubApi({ get: () => state(true) });
    await render();
    await settle();
    expect(slot().textContent).toContain("There’s a new version");
    expect(slot().querySelector("button")!.textContent).toBe("Update");
    // It said so; it did not do it.
    expect(posts(calls)).toHaveLength(0);
    expect(frame().getAttribute("src")).toBe(APP.frameUrl);
    // Announced to a screen reader when it appears.
    expect(slot().getAttribute("role")).toBe("status");
  });

  // «Actualizar» is a one-tap install: it applies the non-destructive migrations to the SAME production the published site
  // uses (spec §5), so the strip says so — beside the button — when the project has a site.
  const SHARED = "Your published site uses this same data.";
  const stateOf = (published: boolean) => json({ desktopApp: { id: "d1", releaseSha: "sha1" }, updateAvailable: true, published });

  it("the update notice says the site shares the data when published", async () => {
    stubApi({ get: () => stateOf(true) });
    await render();
    await settle();
    expect(slot().textContent).toContain("There’s a new version");
    expect(slot().textContent).toContain(SHARED);
    expect(slot().querySelector("button")!.textContent).toBe("Update");
  });

  it("the update notice says nothing of a site when unpublished", async () => {
    stubApi({ get: () => stateOf(false) });
    await render();
    await settle();
    expect(slot().textContent).toContain("There’s a new version");
    expect(slot().textContent).not.toContain(SHARED);
    expect(slot().querySelector("button")!.textContent).toBe("Update");
  });

  it("nothing to say: no notice (not updated, not asked yet, or the question failed)", async () => {
    stubApi({ get: () => state(false) });
    await render();
    await settle();
    expect(slot().textContent).toBe("");

    stubApi({ get: () => json({ error: "boom" }, 500) });
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(slot().textContent).toBe("");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(slot().textContent).toBe("");
    expect(frame().getAttribute("src")).toBe(APP.frameUrl);
  });

  it("a notice that was up goes away when the project is back to what is installed", async () => {
    let available = true;
    stubApi({ get: () => state(available) });
    await render();
    await settle();
    expect(slot().textContent).toContain("new version");
    available = false;
    await aMinuteLater();
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(slot().textContent).toBe("");
  });

  it("a release installed elsewhere shows the notice", async () => {
    // The project is what was installed (`updateAvailable: false`), but the installed release is not the one this frame runs:
    // the person updated from the workspace after a gate sent them there.
    let installedSha = "sha9";
    const calls = stubApi({
      get: () => json({ desktopApp: { id: "d1", releaseSha: installedSha }, updateAvailable: false, published: false }),
      post: () => installed("sha9"),
    });
    await render();
    await settle();
    expect(slot().textContent).toContain("There’s a new version");
    expect(slot().querySelector("button")!.textContent).toBe("Update");
    // Only the strip says so: nothing reloads by itself, nothing is asked of the server.
    expect(frame().getAttribute("src")).toBe(APP.frameUrl);
    expect(posts(calls)).toHaveLength(0);

    // The button runs the same install and the frame lands on that release; asked again, it has nothing more to say.
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(posts(calls)).toEqual([{ method: "POST", body: JSON.stringify({ locale: "en", fromWindow: true }) }]);
    expect(frame().getAttribute("src")).toBe("https://lienzo-0123456789abcdef0123456789abcdef.openlen.app/?v=sha9");
    expect(slot().textContent).toBe("");
    await aMinuteLater();
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(slot().textContent).toBe("");

    // And it goes on comparing with what the frame shows, not with what it opened with.
    installedSha = "sha10";
    await aMinuteLater();
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(slot().textContent).toContain("There’s a new version");
  });

  it("Actualizar 200 reloads the frame with the new releaseSha", async () => {
    const calls = stubApi({ get: () => state(true), post: () => installed("sha2") });
    await render();
    await settle();
    const before = frame();
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
    // The POST is the locale and who is asking: the gates' dialogs live in the workspace, and «from the window» is how the
    // route knows not to bring back an app that was removed elsewhere.
    expect(posts(calls)).toEqual([{ method: "POST", body: JSON.stringify({ locale: "en", fromWindow: true }) }]);
    expect(frame().getAttribute("src")).toBe(FRAME_SHA2);
    expect(frame()).not.toBe(before);
    expect(host.querySelectorAll("iframe")).toHaveLength(1);
    expect(slot().textContent).toBe("");
  });

  it("while it updates the button says so and a second press sends nothing", async () => {
    let done!: (r: Response) => void;
    const calls = stubApi({ get: () => state(true), post: () => new Promise<Response>((resolve) => void (done = resolve)) });
    await render();
    await settle();
    const press = () => (slot().querySelector("button") as HTMLButtonElement).click();
    await act(async () => void press());
    await settle();
    const working = slot().querySelector("button") as HTMLButtonElement;
    expect(working.textContent).toBe("Updating…");
    expect(working.disabled).toBe(true);
    await act(async () => void press());
    expect(posts(calls)).toHaveLength(1);
    await act(async () => done(installed("sha2")));
    await settle();
    expect(frame().getAttribute("src")).toBe(FRAME_SHA2);
  });

  it("a tool's frame reloads with the new version in its context too", async () => {
    stubApi({ get: () => state(true), post: () => installed("sha2") });
    await render({ toolInstallationId: "ti1" });
    await settle();
    expect(bridge.create).toHaveBeenCalledTimes(1);
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(frame().getAttribute("src")).toBe(FRAME_SHA2);
    const options = bridge.create.mock.calls.at(-1)![0] as { context(): { tool: { version: string } } };
    expect(options.context().tool.version).toBe("sha2");
  });

  it("a question that was still out when the update landed does not bring the notice back", async () => {
    let late!: (r: Response) => void;
    let n = 0;
    stubApi({
      get: () => (++n === 1 ? state(true) : new Promise<Response>((resolve) => void (late = resolve))),
      post: () => installed("sha2"),
    });
    await render();
    await settle();
    await aMinuteLater();
    await act(async () => void setVisibility("visible")); // asks again; the answer is slow
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(frame().getAttribute("src")).toBe(FRAME_SHA2);
    await act(async () => late(state(true)));
    await settle();
    expect(slot().textContent).toBe("");
  });

  it.each([
    ["a 428 of the security review", 428, { error: "security_findings" }, "security review found something"],
    ["a 428 of a review still running", 428, { error: "security_review_pending" }, "still running"],
    ["a 428 that asks to confirm a data change", 428, { error: "confirmation_required", destructive: true }, "needs your OK in OpenLen"],
    ["a 422 that doesn’t compile", 422, { error: "app_does_not_compile", errors: ["/src/App.jsx:3 nope"] }, "has a problem"],
    ["a 422 of a tool manifest", 422, { error: "tool_manifest_invalid", problems: [] }, "has a problem"],
  ])("Actualizar stopped by %s shows the reason and the open-in-OpenLen link, frame untouched", async (_name, status, body, reason) => {
    let answer = () => json(body, status);
    const calls = stubApi({ get: () => state(true), post: () => answer() });
    await render({ locale: "es" });
    await settle();
    const before = frame();
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();

    expect(slot().textContent).toContain(reason);
    const link = slot().querySelector("a")!;
    expect(link.textContent).toBe("Open in OpenLen");
    expect(link.getAttribute("href")).toBe("/es/new?project=p1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // The version that was running still is: the same frame, the same address, nothing asked of the server twice.
    expect(frame()).toBe(before);
    expect(frame().getAttribute("src")).toBe(APP.frameUrl);

    // Once the person has dealt with it in OpenLen, the same button tries again.
    answer = () => installed("sha2");
    const retry = slot().querySelector("button") as HTMLButtonElement;
    expect(retry.textContent).toBe("Update");
    expect(retry.disabled).toBe(false);
    await act(async () => void retry.click());
    await settle();
    expect(posts(calls)).toHaveLength(2);
    expect(frame().getAttribute("src")).toBe(FRAME_SHA2);
    expect(slot().textContent).toBe("");
  });

  it("any other failure — the server’s or the network’s — says so, with the link, and leaves the frame alone", async () => {
    let answer: () => Response | Promise<Response> = () => json({ error: "install_failed" }, 500);
    stubApi({ get: () => state(true), post: () => answer() });
    await render();
    await settle();
    const before = frame();
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(slot().textContent).toContain("Couldn’t update");
    expect(slot().querySelector("a")).not.toBeNull();
    expect(frame()).toBe(before);

    answer = () => Promise.reject(new TypeError("offline"));
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
    expect(slot().textContent).toContain("Couldn’t update");
    expect((slot().querySelector("button") as HTMLButtonElement).disabled).toBe(false);
    expect(frame()).toBe(before);
  });

  // THE WORDS OF A REFUSAL (as Claude's «Couldn't install {app}.»): the headline and the reason are two lines, never
  // «Couldn’t update (reason)»; a cause that is known has its own reason and, when something fixes it, the one link that does.
  const headline = () => slot().querySelector("[data-desktop-failure-title]")!;
  const reasonLine = () => slot().querySelector("[data-desktop-failure-reason]")!;
  async function pressUpdate() {
    await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
    await settle();
  }

  it("🔴 a refusal is two lines: «Couldn’t update» and the reason — never the reason inside the headline", async () => {
    stubApi({ get: () => state(true), post: () => json({ error: "uses_stripe" }, 409) });
    await render();
    await settle();
    await pressUpdate();
    expect(headline().textContent).toBe("Couldn’t update");
    expect(reasonLine().textContent).toBe("An app that takes payments with Stripe can’t be on the desktop yet.");
    expect(headline()).not.toBe(reasonLine());
    expect(slot().textContent).not.toMatch(/\(|\)/);
  });

  it.each([
    ["a plan that lapsed", 402, "plan_required", "Apps on your desktop come with the paid plans.", ["See plans", "/es/pricing"]],
    ["an editor", 403, "owner_only", "Only the owner can update it on the desktop.", null],
    ["a project that is not an app", 409, "not_an_app", "Only apps can be on the desktop.", null],
    ["a Stripe app", 409, "uses_stripe", "An app that takes payments with Stripe can’t be on the desktop yet.", null],
    ["a tool that is not installed", 409, "tool_not_installed", "Install this tool first in Tools, then update it here.", ["Open Tools", "/es/new?view=tools"]],
    ["the switch being off", 404, "desktop_apps_off", "OpenLen has turned apps on the desktop off for now.", null],
  ] as const)("a known cause — %s — has its own reason, and the one action that fixes it", async (_name, status, error, reason, link) => {
    stubApi({ get: () => state(true), post: () => json({ error }, status) });
    await render({ locale: "es" });
    await settle();
    await pressUpdate();
    expect(reasonLine().textContent).toBe(reason);
    expect(reasonLine().textContent).not.toContain("Try again");
    const anchor = slot().querySelector("a");
    if (link) {
      expect(anchor?.textContent).toBe(link[0]);
      expect(anchor?.getAttribute("href")).toBe(link[1]);
      expect(anchor?.getAttribute("target")).toBe("_blank");
      expect(anchor?.getAttribute("rel")).toContain("noopener");
    } else {
      expect(anchor).toBeNull();
    }
    // Nothing here changes by pressing it again, but it is the person's to try: the button stays.
    expect((slot().querySelector("button") as HTMLButtonElement).disabled).toBe(false);
  });

  it("«Try again» is only for what is unknown: a server error and a network failure", async () => {
    let answer: () => Response | Promise<Response> = () => json({ error: "install_failed" }, 500);
    stubApi({ get: () => state(true), post: () => answer() });
    await render();
    await settle();
    await pressUpdate();
    expect(reasonLine().textContent).toBe("Try again in a moment.");
    answer = () => Promise.reject(new TypeError("offline"));
    await pressUpdate();
    expect(reasonLine().textContent).toBe("Try again in a moment.");
  });

  // M15: Claude reconciles before it acts, and closes the window of an app that was uninstalled. A window left open after
  // the app was removed elsewhere must not bring it back: it says so and stops offering the button.
  it("🔴 «Actualizar» on an app that was removed elsewhere says so, brings nothing back and turns the button off", async () => {
    const calls = stubApi({ get: () => state(true), post: () => json({ error: "desktop_app_removed" }, 409) });
    await render();
    await settle();
    const before = frame();
    await pressUpdate();
    expect(headline().textContent).toBe("Couldn’t update");
    expect(reasonLine().textContent).toContain("It was removed from your desktop in OpenLen.");
    expect(reasonLine().textContent).toContain("Uninstall");
    const button = slot().querySelector("button") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    // No link to try anything: there is nothing to fix.
    expect(slot().querySelector("a")).toBeNull();
    expect(frame()).toBe(before);

    // It stays that way: pressing the disabled button sends nothing, and a later question does not clear it.
    await act(async () => void button.click());
    expect(posts(calls)).toHaveLength(1);
    await aMinuteLater();
    await act(async () => void setVisibility("visible"));
    await settle();
    expect(gets(calls)).toBe(1);
    expect(reasonLine().textContent).toContain("It was removed from your desktop in OpenLen.");
    expect((slot().querySelector("button") as HTMLButtonElement).disabled).toBe(true);
  });

  // M13: the window's title follows the app (Claude's follows its page), and the installed shortcut's name stays.
  describe("the window's name follows the app", () => {
    const named = (name: string, over: Record<string, unknown> = {}) =>
      json({ desktopApp: { id: "d1", url: "/desktop/d1", name, releaseSha: "sha1", installedAt: "2026-11-20T12:00:00.000Z" }, updateAvailable: false, published: false, ...over });
    const strip = () => host.querySelector("[data-desktop-strip]")!;

    afterEach(() => void (document.title = ""));

    it("a new name in what the route reports is the strip's, the About's, the frame's title and the tab's", async () => {
      document.title = "Bookings";
      stubApi({ get: () => named("Reservas") });
      await render();
      await settle();
      expect(strip().querySelector("span")!.textContent).toBe("Reservas");
      expect(frame().getAttribute("title")).toBe("Reservas");
      expect(document.title).toBe("Reservas");
      await act(async () => button("About")!.click());
      expect(host.querySelector("[data-desktop-about]")!.textContent).toContain("Reservas");
    });

    it("an update that lands with another name brings it too", async () => {
      document.title = "Bookings";
      stubApi({ get: () => state(true), post: () => json({ desktopApp: { id: "d1", url: "/desktop/d1", name: "Bookings Pro", releaseSha: "sha2", installedAt: "2026-11-20T12:00:00.000Z" } }) });
      await render();
      await settle();
      expect(document.title).toBe("Bookings");
      await act(async () => void (slot().querySelector("button") as HTMLButtonElement).click());
      await settle();
      expect(strip().querySelector("span")!.textContent).toBe("Bookings Pro");
      expect(frame().getAttribute("title")).toBe("Bookings Pro");
      expect(document.title).toBe("Bookings Pro");
    });

    it("the same name, no name or an empty one leave everything as it was", async () => {
      document.title = "Bookings";
      stubApi({ get: () => named("Bookings") });
      await render();
      await settle();
      expect(strip().querySelector("span")!.textContent).toBe("Bookings");
      expect(document.title).toBe("Bookings");

      stubApi({ get: () => state(false) });
      await aMinuteLater();
      await act(async () => void setVisibility("visible"));
      await settle();
      expect(strip().querySelector("span")!.textContent).toBe("Bookings");
      stubApi({ get: () => named("") });
      await aMinuteLater();
      await act(async () => void setVisibility("visible"));
      await settle();
      expect(strip().querySelector("span")!.textContent).toBe("Bookings");
      expect(document.title).toBe("Bookings");
    });
  });
});

describe("a tool's dialogs, with only the texts the page sends", () => {
  type Options = {
    onConfirmChange(change: unknown): Promise<boolean>;
    onConfirmJob(job: unknown): Promise<boolean>;
    onPickFiles(pick: { multiple: boolean }): Promise<File[] | null>;
    onJobStarted(job: unknown): void;
  };
  const options = () => bridge.create.mock.calls.at(-1)![0] as Options;
  const bodyText = () => document.body.textContent ?? "";
  const bodyButton = (text: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent === text);
  /** What the person would read if a message were missing: the key's own path. */
  const NO_RAW_KEYS = /wsChrome|tools\.(change|jobs|files)/;

  it("🔴 the confirmation before a tool changes production data is in words, not in key paths", async () => {
    await render({ toolInstallationId: "ti1" });
    let answer!: Promise<boolean>;
    await act(async () => {
      answer = options().onConfirmChange({ projectId: "p2", table: "orders", key: { id: 7 }, set: { status: "paid" }, before: { status: "open" }, projectTitle: "Shop" });
    });
    expect(bodyText()).toContain("Bookings wants to change orders in Shop");
    expect(bodyText()).toContain("Nothing is changed until you apply it");
    expect(bodyText()).not.toMatch(NO_RAW_KEYS);
    await act(async () => bodyButton("Apply")!.click());
    await expect(answer).resolves.toBe(true);
  });

  it("🔴 the confirmation of what a job may cost is in words too", async () => {
    await render({ toolInstallationId: "ti1" });
    let answer!: Promise<boolean>;
    await act(async () => {
      answer = options().onConfirmJob({ name: "export", title: "Export report", maxMinutes: 5, mostCentis: 120, files: [{ id: "f1", name: "sales.csv" }] });
    });
    expect(bodyText()).toContain("Bookings wants to run “Export report”");
    expect(bodyText()).toContain("Up to 5 min");
    expect(bodyText()).toContain("sales.csv");
    expect(bodyText()).not.toMatch(NO_RAW_KEYS);
    await act(async () => bodyButton("Cancel")!.click());
    await expect(answer).resolves.toBe(false);
  });

  it("OpenLen's own file picker and the line of a job the frame started", async () => {
    await render({ toolInstallationId: "ti1" });
    await act(async () => void options().onPickFiles({ multiple: false }));
    expect(bodyText()).toContain("Bookings asks for files");
    expect(bodyText()).toContain("Choose files");
    expect(bodyText()).not.toMatch(NO_RAW_KEYS);
    await act(async () => bodyButton("Cancel")!.click());

    const job = { id: "j1", name: "export", title: "Export report", status: "running", progress: null, detail: null, result: null, delivered: [], startedAt: new Date().toISOString(), finishedAt: null, seconds: 0, chargedCentis: 0 };
    await act(async () => options().onJobStarted(job));
    expect(bodyText()).toContain("Export report");
    expect(bodyButton("Stop")).toBeDefined();
    await act(async () => options().onJobStarted({ ...job, status: "failed", finishedAt: new Date().toISOString() }));
    expect(bodyText()).toContain("Failed");
    expect(bodyButton("Close")).toBeDefined();
    expect(bodyText()).not.toMatch(NO_RAW_KEYS);
  });

  it("an ordinary app has no bridge, so none of those texts are sent to it", async () => {
    const plain = await windowMessages("en", { tool: false });
    expect(JSON.stringify(plain)).not.toContain("wants to change");
  });
});
