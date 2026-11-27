// «INSTALAR EN EL ESCRITORIO» IN THE TOP BAR (spec local 2026-11-26-apps-en-el-escritorio, §4.1): the entry lives in the
// Exportar tab of an app's Publicar menu and in the install menu of a tool. Only the owner of an app gets it (the page
// passes `desktopApps`); the rest of the card is tested where it lives (`desktop-apps/`).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/app/credit-pill", () => ({ CreditPill: () => null }));
vi.mock("@/components/openlen-logo", () => ({ OpenLenMark: () => null }));
vi.mock("./artifacts/artifact-tray", () => ({ ArtifactTray: () => null }));
vi.mock("./len-watch/len-watch-settings", () => ({ LenWatchSettings: () => null }));

import { TopBar } from "./top-bar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === "/api/projects/p1/desktop") {
      return new Response(JSON.stringify({ desktopApp: null, updateAvailable: false, published: false }));
    }
    if (String(url) === "/api/projects/p1/preview") return new Response(JSON.stringify({ enabled: false, token: null, expiresAt: null, hasPasscode: false }));
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render(props: { desktopApps?: boolean; isTool?: boolean } = {}) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(<TopBar esApp projectName="Reservas" projectId="p1" onPublish={() => {}} published={null} onRename={() => {}} {...props} />),
  );
}
const desktopCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/projects/p1/desktop");
const click = async (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const tab = (id: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === `deploy.tabs.${id}`);

describe("TopBar · la app en el escritorio", () => {
  it("the Exportar tab of an app's Publicar menu offers it to the owner, and only when that tab is open", async () => {
    await render({ desktopApps: true });
    await click(document.querySelector("button[aria-label='deploy.button']"));
    expect(desktopCalls()).toHaveLength(0);
    await click(tab("exportar"));
    expect(desktopCalls()).toHaveLength(1);
    expect(document.body.textContent).toContain("desktopInstall.menu.install");
  });

  it("without `desktopApps` (not the owner, or not an app) the menu never asks and never offers it", async () => {
    await render({ desktopApps: false });
    await click(document.querySelector("button[aria-label='deploy.button']"));
    await click(tab("exportar"));
    expect(desktopCalls()).toHaveLength(0);
    expect(document.body.textContent).not.toContain("desktopInstall");
  });

  it("a tool's install menu offers it too", async () => {
    await render({ desktopApps: true, isTool: true });
    await click(document.querySelector("button[data-tool-install]"));
    expect(desktopCalls()).toHaveLength(1);
    expect(document.body.textContent).toContain("desktopInstall.menu.install");
  });
});
