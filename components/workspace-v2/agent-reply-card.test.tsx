// Arnés manual de react-dom + act(), como `datos-view.test.tsx`: en el repo no
// hay @testing-library y esta prueba no es motivo para añadirla. Los textos
// llegan por props, así que no hace falta montar next-intl.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentReplyCard, type EtiquetasDeRespuesta } from "./agent-reply-card";
import type { RespuestaPreparada } from "@/lib/agent/resultados";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const labels: EtiquetasDeRespuesta = {
  titulo: (con) => `Borrador para ${con}`,
  tituloSinNombre: "Borrador de respuesta",
  nota: "Nada se manda hasta que lo pulses.",
  enviar: "Enviar",
  enviando: "Enviando…",
  enviado: "✓ Enviado",
  correo: "Responder por correo",
  whatsapp: "Responder por WhatsApp",
  copiar: "Copiar",
  copiado: "✓ Copiado",
  asunto: "Respuesta a tu mensaje",
  error: "No se pudo enviar. Inténtalo de nuevo.",
};

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function pinta(respuesta: RespuestaPreparada) {
  const c = document.createElement("div");
  document.body.appendChild(c);
  await act(async () => {
    const root = createRoot(c);
    roots.push(root);
    root.render(<AgentReplyCard respuesta={respuesta} labels={labels} />);
  });
  return c;
}

const boton = (c: HTMLElement, texto: string) => [...c.querySelectorAll("button")].find((b) => b.textContent === texto)!;

/** Escribir en un <textarea> controlado: el setter nativo + `input`, que es lo
 *  que React escucha. */
function escribe(area: HTMLTextAreaElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(area, valor);
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("AgentReplyCard", () => {
  it("chat: «Enviar» manda el texto por la bandeja y queda enviada", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const c = await pinta({ action: "responder", para: "chat", id: "c1", con: "Juan", texto: "Sí, abrimos el domingo", botones: ["enviar"], correo: null, whatsapp: null });
    await act(async () => { boton(c, "Enviar").click(); });
    expect(fetchMock).toHaveBeenCalledWith("/api/inbox/c1/reply", expect.objectContaining({ method: "POST", body: JSON.stringify({ body: "Sí, abrimos el domingo" }) }));
    expect(c.textContent).toContain("✓ Enviado");
  });
  it("el usuario corrige el borrador y se manda LO CORREGIDO", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as Response));
    vi.stubGlobal("fetch", fetchMock);
    const c = await pinta({ action: "responder", para: "chat", id: "c1", con: "Juan", texto: "Sí", botones: ["enviar"], correo: null, whatsapp: null });
    await act(async () => { escribe(c.querySelector("textarea")!, "Sí, de 9 a 2"); });
    await act(async () => { boton(c, "Enviar").click(); });
    expect(fetchMock).toHaveBeenCalledWith("/api/inbox/c1/reply", expect.objectContaining({ body: JSON.stringify({ body: "Sí, de 9 a 2" }) }));
  });
  it("si la bandeja dice que no, lo dice y se puede reintentar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) } as Response)));
    const c = await pinta({ action: "responder", para: "chat", id: "c1", con: "Juan", texto: "Hola", botones: ["enviar"], correo: null, whatsapp: null });
    await act(async () => { boton(c, "Enviar").click(); });
    expect(c.textContent).toContain("No se pudo enviar");
    expect(boton(c, "Enviar").disabled).toBe(false);
  });
  it("formulario: los enlaces llevan el texto y nada se manda sin tocar", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const c = await pinta({ action: "responder", para: "formulario", id: "f1", con: "María", texto: "Hola María", botones: ["correo", "whatsapp", "copiar"], correo: "maria@ejemplo.com", whatsapp: "523312345678" });
    const enlaces = [...c.querySelectorAll("a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(enlaces).toContainEqual(["Responder por correo", "mailto:maria@ejemplo.com?subject=Respuesta%20a%20tu%20mensaje&body=Hola%20Mar%C3%ADa"]);
    expect(enlaces).toContainEqual(["Responder por WhatsApp", "https://wa.me/523312345678?text=Hola%20Mar%C3%ADa"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("«Copiar» copia el texto y lo dice", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const c = await pinta({ action: "responder", para: "formulario", id: "f1", con: null, texto: "Hola", botones: ["copiar"], correo: null, whatsapp: null });
    await act(async () => { boton(c, "Copiar").click(); });
    expect(writeText).toHaveBeenCalledWith("Hola");
    expect(c.textContent).toContain("✓ Copiado");
  });
  it("sin nombre, el título genérico", async () => {
    const c = await pinta({ action: "responder", para: "formulario", id: "f1", con: null, texto: "Hola", botones: ["copiar"], correo: null, whatsapp: null });
    expect(c.textContent).toContain("Borrador de respuesta");
  });
});
