// @vitest-environment jsdom
//
// EL PERFIL, con los textos REALES en español. Lo que se ve lo decide el
// servidor (`getProfile`, con su prueba contra Postgres); esto prueba lo que la
// página hace con ello.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import explore from "@/messages/es/explore.json";
import type { ProfileData, ProfileProject } from "@/lib/profile/types";

const m = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), update: vi.fn(async () => null) }));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
  useRouter: () => ({ replace: m.replace, refresh: m.refresh }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ update: m.update }) }));

import { ProfileView } from "./profile-view";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proyecto = (id: string, over: Partial<ProfileProject> = {}): ProfileProject => ({
  id,
  title: `Proyecto ${id}`,
  thumbnailUrl: null,
  deployUrl: `https://${id}.openlen.app`,
  role: "dueno",
  shared: false,
  canOpen: false,
  updatedAt: "2026-10-10T00:00:00.000Z",
  ...over,
});
const perfil = (over: Partial<ProfileData> = {}): ProfileData => ({
  userId: "u-ana",
  handle: "ana",
  name: "Ana",
  bio: "Hago páginas",
  avatar: null,
  hasCustomAvatar: false,
  links: ["https://ana.dev"],
  pinned: [],
  projects: [],
  sharedCount: 0,
  isSelf: false,
  ...over,
});

const roots: Root[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function pintar(p: ProfileData): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <NextIntlClientProvider locale="es" messages={{ explore }}>
        <ProfileView profile={p} />
      </NextIntlClientProvider>,
    ),
  );
  return host;
}
const boton = (host: HTMLElement, texto: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto) as HTMLButtonElement | undefined;
const tarjetas = (host: HTMLElement) => [...host.querySelectorAll("[data-profile-project]")].map((e) => e.getAttribute("data-profile-project"));
function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("el perfil de otra persona", () => {
  it("🔴 sin «Editar perfil» ni «Cambiar foto»; los fijados van aparte y no se repiten", () => {
    const host = pintar(perfil({ pinned: [proyecto("a")], projects: [proyecto("b")] }));
    expect(boton(host, "Editar perfil")).toBeUndefined();
    expect(host.querySelector("[data-change-photo]")).toBeNull();
    expect(host.textContent).toContain("Fijados");
    expect(tarjetas(host)).toEqual(["a", "b"]);
    expect(host.querySelector('a[href="https://ana.dev"]')?.textContent).toContain("ana.dev");
  });

  it("🔴 un compañero: «Trabajan juntos en 1 proyecto» deja sólo los compartidos, y «Ver todos» los devuelve", () => {
    const host = pintar(perfil({ projects: [proyecto("b", { shared: true, canOpen: true }), proyecto("c")], sharedCount: 1 }));
    act(() => boton(host, "Trabajan juntos en 1 proyecto")!.click());
    expect(tarjetas(host)).toEqual(["b"]);
    expect(host.querySelector('[data-profile-project="b"] a')?.getAttribute("href")).toBe("/new?project=b");
    act(() => boton(host, "Ver todos")!.click());
    expect(tarjetas(host)).toEqual(["b", "c"]);
  });

  it("un desconocido no ve «Trabajan juntos»", () => {
    expect(pintar(perfil({ projects: [proyecto("c")] })).textContent).not.toContain("Trabajan juntos");
  });
});

describe("tu perfil", () => {
  it("🔴 un enlace que no es web no se manda, y se marca", () => {
    const host = pintar(perfil({ isSelf: true, links: [] }));
    act(() => boton(host, "Editar perfil")!.click());
    act(() => boton(host, "Añadir enlace")!.click());
    escribir(host.querySelector<HTMLInputElement>('input[placeholder="instagram.com/tunombre"]')!, "javascript:alert(1)");
    act(() => boton(host, "Guardar")!.click());
    expect(host.textContent).toContain("Eso no es una dirección web.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("🔴 guardar manda lo escrito y refresca la sesión y la página", async () => {
    const host = pintar(perfil({ isSelf: true, pinned: [proyecto("a", { canOpen: true })], links: [] }));
    act(() => boton(host, "Editar perfil")!.click());
    escribir(host.querySelector<HTMLInputElement>('input[maxlength="50"]')!, "Ana Nueva");
    await act(async () => boton(host, "Guardar")!.click());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/profile",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Ana Nueva", bio: "Hago páginas", links: [], pinnedProjectIds: ["a"] }) }),
    );
    expect(m.update).toHaveBeenCalledWith({ refresh: true });
    expect(m.refresh).toHaveBeenCalled();
  });

  it("no se fijan más de 6", () => {
    const seis = ["1", "2", "3", "4", "5", "6"].map((id) => proyecto(id, { canOpen: true }));
    const host = pintar(perfil({ isSelf: true, pinned: seis, projects: [proyecto("7", { canOpen: true })] }));
    act(() => boton(host, "Editar perfil")!.click());
    act(() => host.querySelector<HTMLButtonElement>('[data-profile-project="7"] button[aria-label="Fijar"]')!.click());
    expect(host.textContent).toContain("Puedes fijar hasta 6.");
  });

  it("«Cambiar foto» sólo en el tuyo; un GIF se rechaza sin abrir el recorte", () => {
    const host = pintar(perfil({ isSelf: true }));
    const input = host.querySelector<HTMLInputElement>("[data-change-photo] input[type=file]")!;
    const gif = new File([new Uint8Array(4)], "a.gif", { type: "image/gif" });
    Object.defineProperty(input, "files", { value: [gif], configurable: true });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(host.textContent).toContain("Usa una imagen JPG, PNG o WebP.");
    expect(document.querySelector("[data-avatar-cropper]")).toBeNull();
  });
});
