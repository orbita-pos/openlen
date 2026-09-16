import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Las cadenas REALES del español, no un doble: así, si la Tarea 4 se dejó una
// clave, esta prueba lo dice en vez de pasar con un stub complaciente.
import mensajes from "../../messages/es/wsPage.json";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string, valores?: Record<string, string>) => {
    let v: unknown = mensajes;
    for (const parte of clave.split(".")) v = (v as Record<string, unknown> | undefined)?.[parte];
    if (typeof v !== "string") return clave;
    return v.replace(/\{(\w+)\}/g, (_m, k: string) => String(valores?.[k] ?? ""));
  },
}));

import { FranjaDeEstado } from "./franja-de-estado";

const BASE = {
  projectId: "p1",
  nombrePagina: "Taller Sauco",
  publicada: true,
  cambiosSinPublicar: false,
  asistente: false,
  chat: false,
  onAjustesGuardados: vi.fn(),
};

let contenedor: HTMLDivElement | null = null;
let raiz: Root | null = null;

function pintar(props: Parameters<typeof FranjaDeEstado>[0]): HTMLDivElement {
  contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<FranjaDeEstado {...props} />);
  });
  return contenedor;
}

afterEach(() => {
  // Un `expect` que falla a mitad de una prueba con fetch mockeado no debe
  // dejar el stub puesto para la siguiente — de ahí que viva aquí y no al
  // final de cada `it` (Minor 1 del repaso de la Tarea 6).
  vi.unstubAllGlobals();
  if (raiz) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

describe("FranjaDeEstado", () => {
  it("🔴 dice quién contesta, con el nombre de la página", () => {
    const c = pintar({ ...BASE, asistente: true, chat: true });
    const franja = c.querySelector('[role="status"]');
    expect(franja).not.toBeNull();
    expect(franja!.textContent).toContain("Taller Sauco");
    expect(franja!.textContent).toMatch(/contesta la IA/i);
  });

  it("🔴 SIN PROYECTO no pinta nada — la bandeja suelta sigue igual", () => {
    // El alcance viene del taller (?project=<id>&view=messages). Sin ese
    // parámetro la bandeja es de la CUENTA y la configuración es del PROYECTO:
    // mezclarlas es la costura que esta franja evita.
    const c = pintar({ ...BASE, projectId: null });
    expect(c.innerHTML).toBe("");
  });

  it("dice que falta publicar cuando la página no está publicada", () => {
    const c = pintar({ ...BASE, asistente: true, publicada: false });
    expect(c.querySelector('[role="status"]')!.textContent).toMatch(/publiques/i);
  });

  it("🔴 PUBLICADA pero con cambios sin publicar: también «cuando publiques»", () => {
    // Las burbujas se hornean al publicar: encender el asistente no la pone en
    // la página viva hasta volver a publicar. Ver lib/inbox/estado-de-la-burbuja.ts.
    const c = pintar({ ...BASE, asistente: true, cambiosSinPublicar: true });
    expect(c.querySelector('[role="status"]')!.textContent).toMatch(/publiques/i);
  });

  it("BRAZO DE CONTROL: el texto CAMBIA con el estado", () => {
    // Si la franja pintara siempre la misma cadena, las pruebas de arriba
    // podrían pasar por coincidencia de subcadena.
    const a = pintar({ ...BASE }).textContent;
    const b = pintar({ ...BASE, asistente: true, chat: true }).textContent;
    expect(a).not.toBe(b);
  });

  it("🔴 al desplegar salen DOS interruptores, y ninguno es un formulario de doce campos", () => {
    const c = pintar({ ...BASE });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    expect(c.querySelectorAll('[role="switch"]')).toHaveLength(2);
    // Los ajustes finos NO están a la vista la primera vez.
    expect(c.textContent).not.toMatch(/hechos|bienvenida/i);
  });

  it("encender el asistente escribe por el EMBUDO, no por una ruta propia", async () => {
    const llamadas: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      llamadas.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response("{}", { status: 200 });
    });
    const c = pintar({ ...BASE });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    await act(async () => {
      c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.click();
    });
    expect(llamadas[0]!.url).toContain("/settings");
    expect(llamadas[0]!.url).not.toContain("/assistant");
    expect(llamadas[0]!.body).toEqual({ assistant: { enabled: true } });
  });

  it("🔴 tras guardar, avisa al taller con el parche — el taller es quien marca la deriva", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    await act(async () => {
      c.querySelectorAll<HTMLElement>('[role="switch"]')[1]!.click();
    });
    expect(onAjustesGuardados).toHaveBeenCalledWith({ chat: { enabled: true } });
  });

  it("BRAZO DE CONTROL: si el guardado falla, el interruptor vuelve y NO se avisa", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    await act(async () => {
      c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.click();
    });
    expect(onAjustesGuardados).not.toHaveBeenCalled();
    expect(c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.getAttribute("aria-checked")).toBe("false");
  });

  it("🔴 tras guardar, el interruptor vuelve a leer la prop", async () => {
    // Fix ronda 1 (repaso Tarea 6): un override que sobreviviera al éxito
    // dejaría el interruptor mintiendo si algo más — Len, desde el Chat —
    // cambia el ajuste por debajo mientras la Bandeja sigue abierta.
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    await act(async () => {
      c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.click();
    });
    // El taller vuelve a pintar el MISMO nodo con la prop ya cambiada —
    // Len acaba de apagar el asistente desde el Chat.
    act(() => {
      raiz!.render(
        <FranjaDeEstado {...BASE} asistente={false} onAjustesGuardados={onAjustesGuardados} />,
      );
    });
    expect(
      c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("mientras guarda, el interruptor no admite otro clic — y el otro sigue usable", async () => {
    let resolver!: (value: Response) => void;
    const promesa = new Promise<Response>((resolve) => {
      resolver = resolve;
    });
    let llamadas = 0;
    vi.stubGlobal("fetch", () => {
      llamadas += 1;
      return promesa;
    });
    const c = pintar({ ...BASE });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    const asistenteBtn = () => c.querySelectorAll<HTMLButtonElement>('[role="switch"]')[0]!;
    const chatBtn = () => c.querySelectorAll<HTMLButtonElement>('[role="switch"]')[1]!;
    act(() => {
      asistenteBtn().click();
    });
    expect(asistenteBtn().disabled).toBe(true);
    expect(chatBtn().disabled).toBe(false); // el otro interruptor sigue usable
    act(() => {
      asistenteBtn().click(); // segundo clic mientras guarda: se ignora
    });
    expect(llamadas).toBe(1);
    await act(async () => {
      resolver(new Response("{}", { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(asistenteBtn().disabled).toBe(false);
  });

  it("🔴 si el fetch lanza, el interruptor vuelve a leer la prop y no avisa", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("network down");
    });
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    act(() => {
      c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
    });
    await act(async () => {
      c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.click();
    });
    expect(onAjustesGuardados).not.toHaveBeenCalled();
    expect(
      c.querySelectorAll<HTMLElement>('[role="switch"]')[0]!.getAttribute("aria-checked"),
    ).toBe("false");
  });
});
