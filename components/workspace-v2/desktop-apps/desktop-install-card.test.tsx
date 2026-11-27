// «INSTALAR EN EL ESCRITORIO» FROM THE WORKSPACE (spec local 2026-11-26-apps-en-el-escritorio, §4.1, §5): the card of a
// tool's install, pointed at the desktop route. Same gates, same dialogs; the only new things are where it posts, the
// line about the published site's data, and opening the window when it goes through.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import { DesktopInstallCard } from "./desktop-install-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const fetchMock = vi.fn();
const openMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  openMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "open").mockImplementation(openMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DESKTOP_APP = { id: "d1", url: "/desktop/d1", name: "Reservas", releaseSha: "abc123", installedAt: "2026-11-26T10:00:00.000Z" };
const ok = (body: unknown = { desktopApp: DESKTOP_APP, published: false }) => new Response(JSON.stringify(body));

async function render(props: { published?: boolean; update?: boolean } = {}) {
  const onInstalled = vi.fn();
  const onCancelled = vi.fn();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      <DesktopInstallCard
        projectId="p1"
        title="Reservas"
        published={props.published ?? false}
        update={props.update ?? false}
        onInstalled={onInstalled}
        onCancelled={onCancelled}
      />,
    ),
  );
  return { onInstalled, onCancelled };
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("DesktopInstallCard", () => {
  it("posts to the desktop endpoint, not to the tool install one", async () => {
    fetchMock.mockResolvedValue(ok());
    await render();
    await act(async () => button("desktopInstall.install").click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/desktop", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ locale: "es" });
  });

  it("shows the shared-data notice when published", async () => {
    await render({ published: true });
    expect(document.body.textContent).toContain("desktopInstall.sharedWithSite");
  });

  it("has no shared-data notice when there is no published site", async () => {
    await render({ published: false });
    expect(document.body.textContent).not.toContain("desktopInstall.sharedWithSite");
  });

  it("opens the desktop url on success", async () => {
    fetchMock.mockResolvedValue(ok());
    const r = await render();
    await act(async () => button("desktopInstall.install").click());
    expect(openMock).toHaveBeenCalledWith("/desktop/d1", "_blank");
    expect(r.onInstalled).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("desktopInstall.installed");
    // A blocked pop-up (the install may take longer than a click lasts): the address stays at hand.
    expect(document.querySelector<HTMLAnchorElement>("a[href='/desktop/d1']")?.target).toBe("_blank");
  });

  it("opens nothing when it did not go through", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "uses_stripe" }), { status: 409 }));
    const r = await render();
    await act(async () => button("desktopInstall.install").click());
    expect(openMock).not.toHaveBeenCalled();
    expect(r.onInstalled).not.toHaveBeenCalled();
  });

  it("428 security_findings shows the same accept flow as a tool install", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "security_findings", fingerprint: "fp1", status: "done", blocking: [{ key: "k", source: "rule", severity: "HIGH", category: "rls_off", file: null, line: null, description: "RLS off" }], medium: [], accepted: [] }), { status: 428 }),
    );
    fetchMock.mockResolvedValueOnce(ok());
    const r = await render();
    await act(async () => button("desktopInstall.install").click());
    expect(document.body.textContent).toContain("RLS off");
    expect(openMock).not.toHaveBeenCalled();
    await act(async () => button("installCard.installAnyway").click());
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["/api/projects/p1/desktop", "/api/projects/p1/desktop"]);
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ acceptSecurityFingerprint: "fp1" });
    expect(openMock).toHaveBeenCalledWith("/desktop/d1", "_blank");
    expect(r.onInstalled).toHaveBeenCalled();
  });

  it("428 confirmation_required asks before destroying data, and only then posts the confirmation", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "confirmation_required", fingerprint: "dc1", destructive: [] }), { status: 428 }));
    fetchMock.mockResolvedValueOnce(ok());
    await render();
    await act(async () => button("desktopInstall.install").click());
    expect(document.body.textContent).toContain("installCard.destructive");
    await act(async () => button("installCard.installAnyway").click());
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ confirmFingerprint: "dc1" });
  });

  it("an update says so, in its title and in its button", async () => {
    fetchMock.mockResolvedValue(ok());
    await render({ update: true });
    expect(document.body.textContent).toContain('desktopInstall.updateTitle {"title":"Reservas"}');
    await act(async () => button("desktopInstall.update").click());
    expect(document.body.textContent).toContain("desktopInstall.updated");
    expect(openMock).toHaveBeenCalledWith("/desktop/d1", "_blank");
  });

  it("an app that uses Stripe is told why it can't be installed (spec §5)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "uses_stripe" }), { status: 409 }));
    await render();
    await act(async () => button("desktopInstall.install").click());
    expect(document.body.textContent).toContain("desktopInstall.reasons.uses_stripe");
  });

  // M14, M18 — as Claude's «Couldn't install {app}.»: the headline and the reason are two lines, never «(reason)»; a cause
  // that is known has its own reason and the one action that fixes it; «try again» is only for what nobody understands.
  describe("a refusal", () => {
    const refuse = async (status: number, body: unknown, props: { update?: boolean } = {}) => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
      await render(props);
      await act(async () => button(props.update ? "desktopInstall.update" : "desktopInstall.install").click());
    };
    const headline = () => document.querySelector("[data-desktop-failure-title]");
    const reason = () => document.querySelector("[data-desktop-failure-reason]");
    const link = () => document.querySelector<HTMLAnchorElement>("[data-desktop-failure] a");

    it("🔴 is two lines — «Couldn’t install «app»» and why — and never the tool's «(reason)»", async () => {
      await refuse(409, { error: "uses_stripe" });
      expect(headline()?.textContent).toBe('desktopInstall.failed.install {"title":"Reservas"}');
      expect(reason()?.textContent).toBe("desktopInstall.reasons.uses_stripe");
      expect(headline()).not.toBe(reason());
      expect(document.body.textContent).not.toContain("installCard.failed");
    });

    it("an update says «couldn’t update», not «couldn’t install»", async () => {
      await refuse(409, { error: "uses_stripe" }, { update: true });
      expect(headline()?.textContent).toBe('desktopInstall.failed.update {"title":"Reservas"}');
    });

    it.each([
      ["a lapsed plan", 402, "plan_required", "desktopInstall.reasons.plan_required", ["desktopInstall.actions.pricing", "/es/pricing"]],
      ["not the owner", 403, "owner_only", "desktopInstall.reasons.owner_only", null],
      ["a page that is not an app", 409, "not_an_app", "desktopInstall.reasons.not_an_app", null],
      ["a tool that isn't installed", 409, "tool_not_installed", "desktopInstall.reasons.tool_not_installed", ["desktopInstall.actions.tools", "/es/new?view=tools"]],
      ["the switch being off", 404, "desktop_apps_off", "desktopInstall.reasons.desktop_apps_off", null],
      ["an app that doesn't compile", 422, "app_does_not_compile", "desktopInstall.reasons.problem", null],
    ] as const)("%s has its own reason and, when something fixes it, the one link that does", async (_name, status, error, text, action) => {
      await refuse(status, { error });
      expect(reason()?.textContent).toBe(text);
      if (action) {
        expect(link()?.textContent).toBe(action[0]);
        expect(link()?.getAttribute("href")).toBe(action[1]);
        expect(link()?.target).toBe("_blank");
        expect(link()?.rel).toContain("noopener");
      } else {
        expect(link()).toBeNull();
      }
    });

    it("«try again» is only for the unknown: a server error and a network failure", async () => {
      await refuse(500, { error: "install_failed" });
      expect(reason()?.textContent).toBe("desktopInstall.reasons.failed");
      expect(link()).toBeNull();
    });

    it("a network failure too, and the install button is there to try again", async () => {
      fetchMock.mockRejectedValue(new TypeError("offline"));
      await render();
      await act(async () => button("desktopInstall.install").click());
      expect(reason()?.textContent).toBe("desktopInstall.reasons.failed");
      expect(button("desktopInstall.install")).toBeDefined();
    });
  });

  it("«Cancelar» turns it off without posting", async () => {
    const r = await render();
    await act(async () => button("installCard.cancel").click());
    expect(r.onCancelled).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
