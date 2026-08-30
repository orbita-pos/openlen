// Cobertura de render del campo de referencia. Mismo arnés manual de
// react-dom + act() que ../workspace-v2/scan-overlay.test.tsx (este repo no
// tiene @testing-library), con next-intl mockeado a un pasapuertas de claves
// — las aserciones miran la clave cruda.
//
// Citaba panels/collections-panel.test.tsx, borrado el 2026-08-29 con el
// módulo.
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
    const c = render({ brief: "", reference: DIRECCION, onChange: () => {} });
    expect(c.textContent).toContain("ejemplo.test");
    const muestras = c.querySelectorAll("span[style]");
    expect(muestras.length).toBe(2);
    expect((muestras[0] as HTMLElement).style.background).toBe("rgb(83, 58, 253)");
  });

  it("la equis la quita — y avisa con null, no con un objeto vacío", () => {
    const cambios: (StyleDirection | null)[] = [];
    const c = render({ brief: "", reference: DIRECCION, onChange: (d) => cambios.push(d) });
    click(c.querySelector('[aria-label="aiBrief.reference.remove"]'));
    expect(cambios).toEqual([null]);
  });

  /**
   * SIN DIRECCIÓN ESCRITA NO HAY NADA. Ni un botón: el gesto es escribir, y un
   * botón que no hace falta es una cosa más que descubrir. Antes había uno de
   * cadena que abría un campo — cuatro gestos para lo que ahora es teclear.
   */
  it("sin nada escrito no ocupa sitio — ni un botón", () => {
    const c = render({ brief: "una landing para mi taller", reference: null, onChange: () => {} });
    expect(c.textContent).toBe("");
    expect(c.querySelector("button")).toBeNull();
    expect(c.querySelector("input")).toBeNull();
  });
});

describe("la dirección sale de lo que el usuario escribió", () => {
  function respondeCon(direction: StyleDirection | null, ok = true) {
    const fetchSpy = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 502,
      json: async () => (direction ? { direction } : {}),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy as unknown as ReturnType<typeof vi.fn>;
  }

  /** El respiro existe porque el usuario está ESCRIBIENDO: sin él, cada tecla
   *  después de pegar la dirección dispararía una petición. */
  async function pasaElRespiro() {
    await act(async () => {
      vi.advanceTimersByTime(800);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("se trae sola, sin que haya que pulsar nada", async () => {
    vi.useFakeTimers();
    const fetchSpy = respondeCon(DIRECCION);
    const cambios: (StyleDirection | null)[] = [];
    render({
      brief: "hazme una como https://ejemplo.test pero para tatuajes",
      reference: null,
      onChange: (d) => cambios.push(d),
    });
    await pasaElRespiro();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(cambios).toEqual([DIRECCION]);
    vi.useRealTimers();
  });

  it("y sin dirección en el texto no se llama a nadie", async () => {
    vi.useFakeTimers();
    const fetchSpy = respondeCon(DIRECCION);
    render({ brief: "una landing para mi taller", reference: null, onChange: () => {} });
    await pasaElRespiro();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  /**
   * MIRAR UNA PÁGINA CUESTA un render y una llamada con visión. Traerla otra vez
   * mientras el usuario termina su frase sería cobrarle por teclear.
   */
  it("cada dirección se trae UNA vez, aunque el brief siga cambiando", async () => {
    vi.useFakeTimers();
    const fetchSpy = respondeCon(DIRECCION);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <ReferenceField brief="como https://ejemplo.test" reference={null} onChange={() => {}} />,
      );
    });
    roots.push(root);
    await pasaElRespiro();
    // Sigue escribiendo detrás de la dirección.
    act(() => {
      root.render(
        <ReferenceField
          brief="como https://ejemplo.test para un taller"
          reference={null}
          onChange={() => {}}
        />,
      );
    });
    await pasaElRespiro();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  /** Un fallo no se reintenta: la dirección sigue escrita, así que reintentar
   *  sería un bucle a cada tecla. Se dice, y no impide generar. */
  it("si falla, se dice y NO se reintenta", async () => {
    vi.useFakeTimers();
    const fetchSpy = respondeCon(null, false);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let root!: Root;
    act(() => {
      root = createRoot(container);
      root.render(
        <ReferenceField brief="como https://ejemplo.test" reference={null} onChange={() => {}} />,
      );
    });
    roots.push(root);
    await pasaElRespiro();
    expect(container.textContent).toContain("aiBrief.reference.error");
    act(() => {
      root.render(
        <ReferenceField brief="como https://ejemplo.test ya" reference={null} onChange={() => {}} />,
      );
    });
    await pasaElRespiro();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
