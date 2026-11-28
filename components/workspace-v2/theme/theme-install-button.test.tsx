// «INSTALAR» IN A THEME PROJECT (spec local 2026-11-27-temas-del-workspace, §4.2): a theme is never published, so its
// owner's top bar says «Instalar» where «Publicar» was; a member sees neither. One tap installs, the toast says what the
// install said, and the workspace reads its themes again.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() }));

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
vi.mock("../artifacts/artifact-tray", () => ({ ArtifactTray: () => null }));
vi.mock("../len-watch/len-watch-settings", () => ({ LenWatchSettings: () => null }));
vi.mock("../toast", () => ({ useToast: () => toast }));
vi.mock("./use-workspace-theme", () => ({ reloadWorkspaceThemes: vi.fn() }));

import { TopBar } from "../top-bar";
import { reloadWorkspaceThemes } from "./use-workspace-theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let installAnswer: () => Response = () => new Response("{}");
const fetchMock = vi.fn();
beforeEach(() => {
  for (const f of Object.values(toast)) f.mockReset();
  vi.mocked(reloadWorkspaceThemes).mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url) === "/api/projects/p1/theme-install") return installAnswer();
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

async function render(props: { isTheme?: boolean; themeOwner?: boolean; themesEnabled?: boolean } = {}) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(<TopBar projectName="Estanque" projectId="p1" onPublish={() => {}} published={null} onRename={() => {}} {...props} />),
  );
}
const installButton = () => document.querySelector<HTMLButtonElement>("button[data-theme-install]");
const publishButton = () => document.querySelector("button[aria-label='deploy.button']");
const installCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]) === "/api/projects/p1/theme-install");
const tap = async () => {
  await act(async () => installButton()!.click());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("TopBar · a theme project", () => {
  it("the owner gets «Instalar» instead of «Publicar», and nothing is installed until they tap it", async () => {
    await render({ isTheme: true, themeOwner: true });
    expect(installButton()?.textContent).toContain("themes.install.button");
    expect(publishButton()).toBeNull();
    expect(installCalls()).toHaveLength(0);
  });

  it("a member sees neither: no install, and no Publicar that would only 409", async () => {
    await render({ isTheme: true, themeOwner: false });
    expect(installButton()).toBeNull();
    expect(publishButton()).toBeNull();
  });

  it("with themes off on the server, the owner has no «Instalar» either (a plugin turned off has no commands), nor a Publicar", async () => {
    await render({ isTheme: true, themeOwner: true, themesEnabled: false });
    expect(installButton()).toBeNull();
    expect(publishButton()).toBeNull();
  });

  it("a project that is not a theme keeps its Publicar", async () => {
    await render();
    expect(installButton()).toBeNull();
    expect(publishButton()).not.toBeNull();
  });

  it("a tap installs in the person's locale, says so with the warnings in words, and repaints the workspace", async () => {
    installAnswer = () =>
      new Response(
        JSON.stringify({
          installation: { id: "inst1" },
          themes: [],
          contrastWarnings: [
            { themeId: "estanque", code: "glass_unmeasured" },
            { themeId: "estanque", code: "glass_unmeasured" },
            { themeId: "noche", code: "palette_pair", fg: "--fg", bg: "--bg", ratio: 2 },
          ],
        }),
      );
    await render({ isTheme: true, themeOwner: true });
    await tap();
    const [url, init] = installCalls()[0]!;
    expect(url).toBe("/api/projects/p1/theme-install");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ locale: "es" });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [title, opts] = toast.success.mock.calls[0]!;
    expect(title).toBe("themes.install.done");
    expect(opts.description).toBe(
      'themes.install.warnings.glass_unmeasured {"theme":"estanque"} · themes.install.warnings.palette_pair {"theme":"noche"}',
    );
    expect(reloadWorkspaceThemes).toHaveBeenCalledTimes(1);
  });

  it("a 422 names each problem with its file, and changes nothing on screen", async () => {
    installAnswer = () =>
      new Response(
        JSON.stringify({
          error: "theme_manifest_invalid",
          problems: [
            { code: "script", file: "/themes/a.svg", detail: "<script>" },
            { code: "missing_meta", file: "/locale/es.json" },
          ],
        }),
        { status: 422 },
      );
    await render({ isTheme: true, themeOwner: true });
    await tap();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = toast.error.mock.calls[0]!;
    expect(title).toBe('themes.install.problems {"count":2}');
    expect(opts.description).toBe(
      'themes.install.problem {"file":"/themes/a.svg","code":"script","detail":" (<script>)"} · themes.install.problem {"file":"/locale/es.json","code":"missing_meta","detail":""}',
    );
    expect(reloadWorkspaceThemes).not.toHaveBeenCalled();
  });

  it("an install already running says so; any other failure is a plain error", async () => {
    installAnswer = () => new Response(JSON.stringify({ error: "install_in_progress" }), { status: 429 });
    await render({ isTheme: true, themeOwner: true });
    await tap();
    expect(toast.info).toHaveBeenCalledWith("themes.install.inProgress");
    installAnswer = () => new Response(JSON.stringify({ error: "owner_only" }), { status: 403 });
    await tap();
    expect(toast.error).toHaveBeenCalledWith("themes.install.failed");
    expect(reloadWorkspaceThemes).not.toHaveBeenCalled();
  });
});
