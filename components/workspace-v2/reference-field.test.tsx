// Cobertura de render del campo de referencia. Mismo arnés manual de
// react-dom + act() que ../workspace-v2/panels/collections-panel.test.tsx (este
// repo no tiene @testing-library), con next-intl mockeado a un pasapuertas de
// claves — las aserciones miran la clave cruda.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { StyleDirection } from "@/lib/style-match/direction-types";
import { ReferenceField } from "./reference-field";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const DIRECCION: StyleDirection = {
  hostname: "ejemplo.test",
  palette: [
    { role: "principal", hex: "#533afd" },
    { role: "neutro 50", hex: "#ffffff" },
  ],
  polarity: "light",
  fontFamily: "Inter",
  radius: "soft",
  character: "Respira mucho.",
};

const roots: Root[] = [];
function render(props: React.ComponentProps<typeof ReferenceField>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<ReferenceField {...props} />);
  });
  roots.push(root);
  return container;
}

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

function click(el: Element | null) {
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * LA PROPIEDAD QUE ES EL DISEÑO, NO UN DETALLE.
 *
 * Si la referencia no se puede quitar, el usuario se entera de que seguía
 * puesta cuando ya pagó una generación con ella.
 */
describe("la referencia se ve y se quita", () => {
  it("puesta, enseña el dominio y sus colores medidos", () => {
    const c = render({ reference: DIRECCION, onChange: () => {} });
    expect(c.textContent).toContain("ejemplo.test");
    const muestras = c.querySelectorAll("span[style]");
    expect(muestras.length).toBe(2);
    expect((muestras[0] as HTMLElement).style.background).toBe("rgb(83, 58, 253)");
  });

  it("la equis la quita — y avisa con null, no con un objeto vacío", () => {
    const cambios: (StyleDirection | null)[] = [];
    const c = render({ reference: DIRECCION, onChange: (d) => cambios.push(d) });
    click(c.querySelector('[aria-label="aiBrief.reference.remove"]'));
    expect(cambios).toEqual([null]);
  });

  it("sin referencia no ocupa sitio: sólo el botón de añadir", () => {
    const c = render({ reference: null, onChange: () => {} });
    expect(c.textContent).toContain("aiBrief.reference.add");
    expect(c.querySelector("input")).toBeNull();
  });
});

describe("traerla", () => {
  async function abrirYEnviar(container: HTMLElement, valor: string) {
    click(container.querySelector("button"));
    const input = container.querySelector("input") as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, valor);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const botones = [...container.querySelectorAll("button")];
    await act(async () => {
      botones[botones.length - 1]!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("una URL buena devuelve la dirección al llamador", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ direction: DIRECCION }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const cambios: (StyleDirection | null)[] = [];
    const c = render({ reference: null, onChange: (d) => cambios.push(d) });

    await abrirYEnviar(c, "ejemplo.test");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [ruta, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(ruta).toBe("/api/style-reference");
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://ejemplo.test/" });
    expect(cambios).toEqual([DIRECCION]);
  });

  // El servidor devuelve códigos opacos a propósito: decir "resuelve a 10.0.0.5"
  // confirma qué hay vivo en la red interna. La UI enseña su propio mensaje.
  it("un bloqueo se cuenta con la clave, nunca con lo que dijo el servidor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "blocked" }) })),
    );
    const cambios: (StyleDirection | null)[] = [];
    const c = render({ reference: null, onChange: (d) => cambios.push(d) });

    await abrirYEnviar(c, "ejemplo.test");

    expect(c.textContent).toContain("aiBrief.reference.error.blocked");
    expect(cambios).toEqual([]);
  });

  it("si la red se cae no se traga el error en silencio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("caída");
      }),
    );
    const c = render({ reference: null, onChange: () => {} });

    await abrirYEnviar(c, "ejemplo.test");

    expect(c.textContent).toContain("aiBrief.reference.error.network");
  });

  // Traer la referencia NO genera. Son dos gestos, y el segundo sigue siendo
  // del usuario: nadie paga una página por pegar un enlace.
  it("traerla no dispara ninguna generación", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ direction: DIRECCION }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const c = render({ reference: null, onChange: () => {} });

    await abrirYEnviar(c, "ejemplo.test");

    const rutas = fetchMock.mock.calls.map((c2) => (c2 as unknown as [string])[0]);
    expect(rutas).not.toContain("/api/generate");
  });
});
