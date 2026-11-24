// SHARING A PROJECT WHOSE CHAT CARRIES THE OWNER'S CONNECTOR RESULTS (spec local 2026-11-24-servidor-de-google-calendar,
// §5.6): every member reads the project's chat, including what Len read from the owner's calendar or email before it was
// shared. The invite form says so — as Claude Code says plainly when something is «visible to everyone … not private».
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) => (v ? `${key} ${JSON.stringify(v)}` : key),
  useLocale: () => "es",
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { MiembrosDialog } from "./miembros-dialog";

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

const OWNER = {
  rol: "dueno",
  yo: "u1",
  dueno: { userId: "u1", email: "yo@x.com", name: "Yo", avatar: null, handle: null },
  miembros: [],
  invitaciones: [],
  tope: null,
  gastoDelMes: 0,
  lenEmail: null,
};

async function render(estado: Record<string, unknown>) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(estado), { status: 200 }));
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<MiembrosDialog projectId="p1" projectTitle="Mi página" open onClose={() => {}} onSalir={() => {}} />));
  await act(async () => {});
}

describe("MiembrosDialog", () => {
  it("🔴 with the owner's connector results in the chat, the invite form says members will see them", async () => {
    await render({ ...OWNER, conectoresEnElChat: true });
    expect(document.querySelector("[data-aviso-conectores]")?.textContent).toBe("miembros.avisoConectores");
  });

  it("without them, nothing is said", async () => {
    await render({ ...OWNER, conectoresEnElChat: false });
    expect(document.querySelector("form")).not.toBeNull();
    expect(document.querySelector("[data-aviso-conectores]")).toBeNull();
  });
});
