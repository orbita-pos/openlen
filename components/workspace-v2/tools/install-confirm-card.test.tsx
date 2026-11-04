// THE «INSTALAR» CARD (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): what Len's `publish` leaves in a tool
// project. Nothing is installed until the person taps; findings of the security review are theirs to accept.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));

import { InstallConfirmCard } from "./install-confirm-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function render() {
  const onInstalled = vi.fn();
  const onCancelled = vi.fn();
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(<InstallConfirmCard projectId="p1" install={{ action: "install", placement: "rail", title: "Reservas" }} onInstalled={onInstalled} onCancelled={onCancelled} />),
  );
  return { onInstalled, onCancelled };
}
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;

describe("InstallConfirmCard", () => {
  it("says what it will install and where", async () => {
    await render();
    expect(document.body.textContent).toContain('installCard.title {"title":"Reservas"}');
    expect(document.body.textContent).toContain("installCard.inRail");
  });

  it("«Instalar» posts to the install route; done, it says so and tells the workspace", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ installation: { id: "i1" } })));
    const changed = vi.fn();
    window.addEventListener("openlen:tools-changed", changed);
    const r = await render();
    await act(async () => button("installCard.install").click());
    expect(fetchMock).toHaveBeenCalledWith("/api/projects/p1/install", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ locale: "es" });
    expect(r.onInstalled).toHaveBeenCalledWith("Reservas");
    expect(changed).toHaveBeenCalled();
    window.removeEventListener("openlen:tools-changed", changed);
  });

  it("findings of the security review: only «Instalar igual» installs, with the person's acceptance", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "security_findings", fingerprint: "fp1", status: "done", blocking: [{ key: "k", source: "rule", severity: "HIGH", category: "rls_off", file: null, line: null, description: "RLS off" }], medium: [], accepted: [] }), { status: 428 }),
    );
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ installation: { id: "i1" } })));
    const r = await render();
    await act(async () => button("installCard.install").click());
    expect(document.body.textContent).toContain("RLS off");
    await act(async () => button("installCard.installAnyway").click());
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))).toMatchObject({ acceptSecurityFingerprint: "fp1" });
    expect(r.onInstalled).toHaveBeenCalled();
  });

  it("«Cancelar» turns it off", async () => {
    const r = await render();
    await act(async () => button("installCard.cancel").click());
    expect(r.onCancelled).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
