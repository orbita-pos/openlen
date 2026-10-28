import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PantallaPrincipal } from "./principal";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("use-intl", () => ({ useTranslations: () => (s: string) => s }));
vi.mock("../cara", () => ({ Cara: () => null }));
vi.mock("../hoja-deslizable", () => ({ useHojaDeslizable: () => null }));
vi.mock("../atras", () => ({ useAtras: () => {} }));
vi.mock("../llamada/llamada", () => ({ Llamada: () => null }));
vi.mock("../chat/chat", () => ({ PantallaChat: () => null }));
vi.mock("../chat/use-chat", () => ({ useChat: () => ({ trabajando: false }) }));

let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  if (root) act(() => root.unmount());
  host?.remove();
  localStorage.clear();
});

describe("recuperar la carga de proyectos", () => {
  it.each(["http", "json", "detalle"])("permite reintentar tras fallo de %s", async (fallo) => {
    let falla = true;
    const proyecto = { id: "p1", title: "Mi página", subdomain: null, publishedAt: null, updatedAt: "2026-10-25", chatHistory: [] };
    const pedir = vi.fn(async (ruta: string) => {
      if (ruta === "/api/projects") {
        if (falla && fallo === "http") return new Response("error", { status: 500 });
        if (falla && fallo === "json") return new Response("no es JSON");
        return Response.json({ projects: [proyecto] });
      }
      if (ruta.endsWith("/preview")) return Response.json({ token: "vista", enabled: true });
      if (falla && fallo === "detalle") return new Response("error", { status: 500 });
      return Response.json({ project: proyecto });
    });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<PantallaPrincipal cliente={{ pedir, avisarAlCerrar: vi.fn() }} idioma="es" onSalir={vi.fn()} />);
    });
    expect(host.textContent).toContain("reintentar");
    falla = false;
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(host.textContent).toContain("Mi página");
    expect(host.textContent).not.toContain("reintentar");
  });
});
