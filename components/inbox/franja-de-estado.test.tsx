import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Las cadenas REALES del español, no un doble: así, si la Tarea 4 se dejó una
// clave, esta prueba lo dice en vez de pasar con un stub complaciente.
import mensajes from "../../messages/es/wsPage.json";
// El cajón cierra con `common.close` y el botón de quitar una respuesta rápida
// se nombra con `common.delete`: el doble resuelve CADA espacio con su fichero,
// no le devuelve la clave a quien pide otro espacio.
import comunes from "../../messages/es/common.json";

vi.mock("next-intl", () => ({
  useTranslations: (espacio?: string) => (clave: string, valores?: Record<string, string>) => {
    let v: unknown = espacio === "common" ? comunes : mensajes;
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
  ajustesChat: undefined,
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

// ─── El detalle de cada bloque (Tarea 7) ────────────────────────────────────
//
// Los ajustes finos del chat y del asistente vivían en `modules-panel.tsx` y
// `assistant-panel.tsx`, que la Tarea 8 demuele. Aquí se muda TODO lo vivo a
// un cajón que abre el enlace «Ajustes» de cada bloque. Estas pruebas miran el
// comportamiento; `nada-se-pierde.test.ts` mira que ningún campo se quede atrás.

type Llamada = { url: string; method: string; body: unknown };

/** Un `fetch` de mentira con rutas: apunta cada petición y responde con la
 *  primera ruta cuyo trozo de URL y método casen (404 si ninguna). */
function fetchConRutas(
  rutas: { url: string; method?: string; status?: number; json?: unknown }[],
): Llamada[] {
  const llamadas: Llamada[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    llamadas.push({
      url: String(url),
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const ruta = rutas.find((r) => String(url).includes(r.url) && (r.method ?? "GET") === method);
    if (!ruta) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(ruta.json ?? {}), { status: ruta.status ?? 200 });
  });
  return llamadas;
}

/** Deja que las promesas en vuelo (fetch → json → setState) se asienten. */
async function asentar() {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function desplegar(c: HTMLElement) {
  act(() => {
    c.querySelector<HTMLButtonElement>('[aria-expanded="false"]')!.click();
  });
}

function boton(raiz: ParentNode, texto: string): HTMLButtonElement {
  const b = Array.from(raiz.querySelectorAll<HTMLButtonElement>("button")).find(
    (x) => x.textContent?.trim() === texto,
  );
  if (!b) throw new Error(`no hay botón «${texto}»`);
  return b;
}

function enlacesDeAjustes(c: HTMLElement): HTMLButtonElement[] {
  return Array.from(c.querySelectorAll<HTMLButtonElement>("button")).filter(
    (b) => b.textContent?.trim() === mensajes.burbuja.bloques.ajustes,
  );
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');

async function abrirDetalle(c: HTMLElement, cual: "asistente" | "chat") {
  desplegar(c);
  const enlace = enlacesDeAjustes(c)[cual === "asistente" ? 0 : 1]!;
  await act(async () => {
    enlace.click();
  });
  await asentar();
  return enlace;
}

/** Escribe en un campo controlado por React como lo haría el teclado. */
function escribir(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const ASISTENTE_LEIDO = { enabled: false, facts: "Abrimos a las 9", tone: "cálido", used: 3, cap: 100 };

describe("el detalle de cada bloque", () => {
  it("🔴 «Ajustes» del asistente abre su detalle en un cajón; Escape lo cierra y el foco vuelve al enlace", async () => {
    fetchConRutas([{ url: "/assistant", json: ASISTENTE_LEIDO }]);
    const c = pintar({ ...BASE });
    const enlace = await abrirDetalle(c, "asistente");
    const d = dialogo();
    expect(d).not.toBeNull();
    expect(d!.textContent).toContain(mensajes.burbuja.detalleAsistente.hechos);
    expect(d!.querySelector("textarea")!.value).toBe("Abrimos a las 9");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(dialogo()).toBeNull();
    expect(document.activeElement).toBe(enlace);
  });

  it("BRAZO DE CONTROL: sin pulsar «Ajustes» no hay cajón, y cada enlace abre SU detalle", async () => {
    fetchConRutas([{ url: "/agents", json: { agents: [] } }]);
    const c = pintar({ ...BASE });
    desplegar(c);
    expect(enlacesDeAjustes(c)).toHaveLength(2);
    expect(dialogo()).toBeNull();
    await act(async () => {
      enlacesDeAjustes(c)[1]!.click();
    });
    await asentar();
    expect(dialogo()!.textContent).toContain(mensajes.chat.welcome);
    expect(dialogo()!.textContent).not.toContain(mensajes.burbuja.detalleAsistente.hechos);
  });

  it("el botón de cerrar también cierra el cajón", async () => {
    fetchConRutas([{ url: "/agents", json: { agents: [] } }]);
    const c = pintar({ ...BASE });
    await abrirDetalle(c, "chat");
    act(() => {
      dialogo()!.querySelector<HTMLButtonElement>(`[aria-label="${comunes.close}"]`)!.click();
    });
    expect(dialogo()).toBeNull();
  });

  it("🔴 el detalle del chat trae TODO lo que vivía en el hub, equipo incluido", async () => {
    fetchConRutas([
      {
        url: "/agents",
        json: { agents: [{ id: "a1", invitedEmail: "ana@taller.mx", status: "active", createdAt: "" }] },
      },
    ]);
    const c = pintar({
      ...BASE,
      ajustesChat: {
        enabled: true,
        mount: "section",
        welcome: "Hola",
        quickReplies: [{ q: "Horario", a: "De 9 a 5" }],
      },
    });
    await abrirDetalle(c, "chat");
    const d = dialogo()!;
    // montaje, CON su ayuda
    expect(boton(d, mensajes.chat.mount.section).getAttribute("aria-pressed")).toBe("true");
    expect(d.textContent).toContain(mensajes.chat.mount.sectionHint);
    // registro abierto + pedir cuenta
    expect(d.querySelectorAll('[role="switch"]')).toHaveLength(2);
    expect(d.textContent).toContain(mensajes.chat.selfServeJoinHint);
    expect(d.textContent).toContain(mensajes.chat.requireAccountHint);
    // bienvenida, tema, respuestas rápidas
    expect(d.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("Hola");
    expect(boton(d, mensajes.chat.themeLight).getAttribute("aria-pressed")).toBe("true");
    expect(d.querySelector<HTMLInputElement>('input[maxlength="40"]')!.value).toBe("Horario");
    expect(d.querySelector<HTMLInputElement>('input[maxlength="500"]')!.value).toBe("De 9 a 5");
    expect(d.querySelector(`[aria-label="${comunes.delete}"]`)).not.toBeNull();
    expect(d.textContent).toContain(mensajes.chat.qrHint);
    // el equipo, que no es un campo de settings
    expect(d.textContent).toContain(mensajes.chat.team.title);
    expect(d.textContent).toContain("ana@taller.mx");
    expect(d.textContent).toContain(mensajes.modulesHub.seePreview);
  });

  it("🔴 un campo del chat guarda por el EMBUDO y avisa al taller con exactamente el parche", async () => {
    const llamadas = fetchConRutas([
      { url: "/agents", json: { agents: [] } },
      { url: "/settings", method: "PATCH" },
    ]);
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    await abrirDetalle(c, "chat");
    await act(async () => {
      boton(dialogo()!, mensajes.chat.mount.section).click();
    });
    await asentar();
    const escrituras = llamadas.filter((l) => l.method === "PATCH");
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]!.url).toBe("/api/projects/p1/settings");
    expect(escrituras[0]!.body).toEqual({ chat: { mount: "section" } });
    expect(onAjustesGuardados).toHaveBeenCalledWith({ chat: { mount: "section" } });
  });

  it("🔴 «pedir cuenta» escribe identityMode «account», no un booleano", async () => {
    const llamadas = fetchConRutas([
      { url: "/agents", json: { agents: [] } },
      { url: "/settings", method: "PATCH" },
    ]);
    const c = pintar({ ...BASE });
    await abrirDetalle(c, "chat");
    await act(async () => {
      dialogo()!.querySelectorAll<HTMLElement>('[role="switch"]')[1]!.click();
    });
    await asentar();
    expect(llamadas.filter((l) => l.method === "PATCH")[0]!.body).toEqual({
      chat: { identityMode: "account" },
    });
  });

  it("BRAZO DE CONTROL: si el embudo dice que no, el taller NO se entera", async () => {
    fetchConRutas([
      { url: "/agents", json: { agents: [] } },
      { url: "/settings", method: "PATCH", status: 500 },
    ]);
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    await abrirDetalle(c, "chat");
    await act(async () => {
      boton(dialogo()!, mensajes.chat.themeDark).click();
    });
    await asentar();
    expect(onAjustesGuardados).not.toHaveBeenCalled();
  });

  it("🔴 dos guardados seguidos no se pisan: la bienvenida y el tema llegan los dos, en orden", async () => {
    // El hub viejo descartaba el segundo si el primero seguía en vuelo: el blur
    // de la bienvenida deshabilitaba el segmento antes de que llegara el clic.
    const llamadas = fetchConRutas([
      { url: "/agents", json: { agents: [] } },
      { url: "/settings", method: "PATCH" },
    ]);
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    await abrirDetalle(c, "chat");
    const d = dialogo()!;
    const bienvenida = d.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    act(() => bienvenida.focus());
    escribir(bienvenida, "Hola, ¿qué buscas?");
    act(() => {
      bienvenida.blur();
      boton(d, mensajes.chat.themeDark).click();
    });
    await asentar();
    expect(llamadas.filter((l) => l.method === "PATCH").map((l) => l.body)).toEqual([
      { chat: { welcome: "Hola, ¿qué buscas?" } },
      { chat: { theme: "dark" } },
    ]);
    expect(onAjustesGuardados).toHaveBeenCalledTimes(2);
  });

  it("🔴 entrar y salir de un campo SIN cambiarlo no escribe — y no marca cambios sin publicar", async () => {
    // Cada guardado le dice al taller «hay cambios sin publicar». Un blur vacío
    // pondría la franja en «cuando publiques» sin que el dueño tocara nada.
    const llamadas = fetchConRutas([
      { url: "/agents", json: { agents: [] } },
      { url: "/settings", method: "PATCH" },
    ]);
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, ajustesChat: { welcome: "Hola" }, onAjustesGuardados });
    await abrirDetalle(c, "chat");
    const bienvenida = dialogo()!.querySelector<HTMLInputElement>('input[maxlength="200"]')!;
    act(() => bienvenida.focus());
    act(() => bienvenida.blur());
    await act(async () => {
      boton(dialogo()!, mensajes.chat.mount.both).click(); // «Ambos» ya es el valor por defecto
    });
    // Una respuesta rápida recién añadida y aún vacía tampoco: el embudo la
    // descartaría, así que no hay nada que guardar.
    act(() => boton(dialogo()!, `+ ${mensajes.chat.qrAdd}`).click());
    const filaNueva = dialogo()!.querySelector<HTMLInputElement>('input[maxlength="40"]')!;
    act(() => filaNueva.focus());
    act(() => filaNueva.blur());
    await asentar();
    expect(llamadas.filter((l) => l.method === "PATCH")).toHaveLength(0);
    expect(onAjustesGuardados).not.toHaveBeenCalled();
    // BRAZO DE CONTROL: con un cambio de verdad, sí escribe.
    act(() => bienvenida.focus());
    escribir(bienvenida, "Hola de nuevo");
    act(() => bienvenida.blur());
    await asentar();
    expect(llamadas.filter((l) => l.method === "PATCH")).toHaveLength(1);
  });

  it("🔴 respuestas rápidas: como mucho SEIS, y quitar una guarda la lista que queda", async () => {
    const llamadas = fetchConRutas([
      { url: "/agents", json: { agents: [] } },
      { url: "/settings", method: "PATCH" },
    ]);
    const seis = Array.from({ length: 6 }, (_, i) => ({ q: `P${i}`, a: `R${i}` }));
    const c = pintar({ ...BASE, ajustesChat: { quickReplies: seis } });
    await abrirDetalle(c, "chat");
    const d = dialogo()!;
    expect(boton(d, `+ ${mensajes.chat.qrAdd}`).disabled).toBe(true);
    await act(async () => {
      d.querySelectorAll<HTMLButtonElement>(`[aria-label="${comunes.delete}"]`)[0]!.click();
    });
    await asentar();
    expect(llamadas.filter((l) => l.method === "PATCH")[0]!.body).toEqual({
      chat: { quickReplies: seis.slice(1) },
    });
    expect(boton(dialogo()!, `+ ${mensajes.chat.qrAdd}`).disabled).toBe(false);
  });

  it("el equipo: invitar y quitar van a /agents", async () => {
    const llamadas = fetchConRutas([
      { url: "/agents/a1", method: "DELETE" },
      {
        url: "/agents",
        json: { agents: [{ id: "a1", invitedEmail: "ana@taller.mx", status: "invited", createdAt: "" }] },
      },
      { url: "/agents", method: "POST", json: {} },
    ]);
    const c = pintar({ ...BASE });
    await abrirDetalle(c, "chat");
    const d = dialogo()!;
    escribir(d.querySelector<HTMLInputElement>('input[type="email"]')!, "  Luis@Taller.MX ");
    await act(async () => {
      boton(d, mensajes.chat.team.invite).click();
    });
    await asentar();
    const invitacion = llamadas.find((l) => l.method === "POST")!;
    expect(invitacion.url).toBe("/api/projects/p1/agents");
    expect(invitacion.body).toEqual({ email: "luis@taller.mx" });
    await act(async () => {
      dialogo()!.querySelector<HTMLButtonElement>(`[aria-label="${mensajes.chat.team.remove}"]`)!.click();
    });
    await asentar();
    expect(llamadas.find((l) => l.method === "DELETE")!.url).toBe("/api/projects/p1/agents/a1");
  });

  it("🔴 el asistente guarda hechos y tono por el embudo, y el tono no admite más de 40", async () => {
    const llamadas = fetchConRutas([
      { url: "/assistant", json: { ...ASISTENTE_LEIDO, facts: "", tone: "" } },
      { url: "/settings", method: "PATCH" },
    ]);
    const onAjustesGuardados = vi.fn();
    const c = pintar({ ...BASE, onAjustesGuardados });
    await abrirDetalle(c, "asistente");
    const d = dialogo()!;
    const tono = d.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(tono.maxLength).toBe(40);
    escribir(d.querySelector("textarea")!, "Abrimos a las 9");
    escribir(tono, "cálido");
    await act(async () => {
      boton(d, mensajes.burbuja.detalleAsistente.guardar).click();
    });
    await asentar();
    const escrituras = llamadas.filter((l) => l.method === "PATCH");
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0]!.url).toBe("/api/projects/p1/settings");
    expect(escrituras[0]!.body).toEqual({ assistant: { facts: "Abrimos a las 9", tone: "cálido" } });
    expect(onAjustesGuardados).toHaveBeenCalledWith({
      assistant: { facts: "Abrimos a las 9", tone: "cálido" },
    });
    expect(dialogo()!.textContent).toContain("3/100");
  });

  it("🔴 si los hechos no se pudieron LEER, no se puede guardar encima de ellos", async () => {
    // Guardar con el campo vacío porque la lectura falló borraría los hechos
    // que el dueño ya escribió. El panel viejo lo permitía.
    fetchConRutas([{ url: "/assistant", status: 500 }]);
    const c = pintar({ ...BASE });
    await abrirDetalle(c, "asistente");
    const d = dialogo()!;
    expect(boton(d, mensajes.burbuja.detalleAsistente.guardar).disabled).toBe(true);
    expect(d.querySelector("textarea")!.disabled).toBe(true);
    expect(d.textContent).toContain(comunes.error);
  });
});
