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

import wsChrome from "@/messages/en/wsChrome.json";
import { WORKSPACE_TOOL_THEME } from "@/lib/tools/bridge/workspace-theme";
import { EARLY_INSTALL_PROMPT_SCRIPT } from "@/lib/desktop-apps/early-install-prompt";
import { DesktopWindow, type DesktopWindowProps } from "./desktop-window";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP: DesktopWindowProps = {
  name: "Bookings",
  frameUrl: "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app/?v=sha1",
  frameOrigin: "https://lienzo-0123456789abcdef0123456789abcdef.openlen.app",
  projectId: "p1",
  releaseSha: "sha1",
  toolInstallationId: null,
  installedAt: "2026-11-20T12:00:00.000Z",
  locale: "en",
  personName: "Ana",
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

async function render(over: Partial<DesktopWindowProps> = {}) {
  await act(async () => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={{ wsChrome }}>
        <DesktopWindow {...APP} {...over} />
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
  vi.useFakeTimers();
  stubDisplayMode(false);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jobs: [] }), { status: 200 })));
  bridge.create.mockClear();
  delete (window as unknown as Record<string, unknown>).__openlenInstallPrompt;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
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

  it("«Not now» and a finished install close it for good", async () => {
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    await act(async () => button("Not now")!.click());
    expect(card()).toBeNull();
    await act(async () => void vi.advanceTimersByTime(3000));
    expect(card()).toBeNull();

    await act(async () => root!.unmount());
    root = createRoot(host);
    delete (window as unknown as Record<string, unknown>).__openlenInstallPrompt;
    await render();
    await act(async () => void window.dispatchEvent(installEvent()));
    expect(card()).not.toBeNull();
    await act(async () => void window.dispatchEvent(new Event("appinstalled")));
    expect(card()).toBeNull();
  });
});
