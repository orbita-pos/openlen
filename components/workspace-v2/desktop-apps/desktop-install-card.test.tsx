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

  it("«Cancelar» turns it off without posting", async () => {
    const r = await render();
    await act(async () => button("installCard.cancel").click());
    expect(r.onCancelled).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
