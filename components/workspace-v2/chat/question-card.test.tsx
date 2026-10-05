// LA TARJETA DE LA PREGUNTA (pieza 3 de Len 2.5): las opciones de
// ask_user_question como botones, la recomendada marcada, varias, «otra», y un
// solo toque cuando es una pregunta de una sola respuesta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { QuestionCardView } from "./question-card";
import type { UserQuestion } from "@/lib/agent/ask-user-question";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

// El traductor devuelve la CLAVE: se comprueba qué cadena pide, no cómo suena.
const t = (clave: string, valores?: Record<string, string>) => (valores ? `${clave}(${Object.values(valores).join(",")})` : clave);

function montar(props: Partial<Parameters<typeof QuestionCardView>[0]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(<QuestionCardView question="¿Cuánto tarda la entrega?" answer={null} t={t} {...props} />);
  });
  return host;
}

const opciones = (host: HTMLElement) => [...host.querySelectorAll('[role="radio"], [role="checkbox"]')] as HTMLButtonElement[];
const boton = (host: HTMLElement, texto: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(texto)) as HTMLButtonElement | undefined;
const escribir = (el: HTMLInputElement | HTMLTextAreaElement, valor: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const plazo: UserQuestion = {
  id: "plazo",
  question: "¿Cuánto tarda la entrega?",
  options: [{ label: "48 horas (Recommended)", description: "Lo que dice tu ficha." }, { label: "Una semana" }],
};

describe("QuestionCardView", () => {
  it("cada opción es un botón con su frase; la recomendada sin el sufijo inglés y con su chapa traducida", () => {
    const host = montar({ questions: [plazo], onAnswer: () => undefined });
    const ops = opciones(host);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.textContent).toContain("48 horas");
    expect(ops[0]!.textContent).not.toContain("(Recommended)");
    expect(ops[0]!.textContent).toContain("newChat.question.recommended");
    expect(ops[0]!.textContent).toContain("Lo que dice tu ficha.");
    expect(ops[1]!.textContent).not.toContain("newChat.question.recommended");
  });

  it("🔴 una sola pregunta de una sola respuesta: un toque contesta, con la etiqueta tal cual la escribió Len", () => {
    const onAnswer = vi.fn();
    const host = montar({ questions: [plazo], onAnswer });
    act(() => opciones(host)[0]!.click());
    expect(onAnswer).toHaveBeenCalledWith([{ id: "plazo", selected: ["48 horas (Recommended)"] }]);
  });

  it("varias a la vez: se marcan y se manda con «Responder», que no se puede pulsar sin elegir", () => {
    const onAnswer = vi.fn();
    const host = montar({
      questions: [{ id: "dias", question: "¿Qué días abres?", multiSelect: true, options: [{ label: "Lunes" }, { label: "Martes" }, { label: "Sábado" }] }],
      onAnswer,
    });
    expect(host.textContent).toContain("newChat.question.pickMany");
    const enviar = boton(host, "newChat.question.send")!;
    expect(enviar.disabled).toBe(true);
    act(() => opciones(host)[0]!.click());
    act(() => opciones(host)[2]!.click());
    expect(opciones(host)[0]!.getAttribute("aria-checked")).toBe("true");
    expect(onAnswer).not.toHaveBeenCalled();
    act(() => enviar.click());
    expect(onAnswer).toHaveBeenCalledWith([{ id: "dias", selected: ["Lunes", "Sábado"] }]);
  });

  it("«otra»: con tus palabras, en vez de una opción", () => {
    const onAnswer = vi.fn();
    const host = montar({ questions: [plazo], onAnswer });
    act(() => boton(host, "newChat.question.other")!.click());
    escribir(host.querySelector("textarea")!, "Tres días hábiles");
    act(() => boton(host, "newChat.question.send")!.click());
    expect(onAnswer).toHaveBeenCalledWith([{ id: "plazo", selected: [], custom: "Tres días hábiles" }]);
  });

  it("una pregunta abierta (sin opciones) se contesta escribiendo", () => {
    const onAnswer = vi.fn();
    const host = montar({ questions: [{ id: "tel", question: "¿Cuál es tu teléfono?" }], onAnswer });
    expect(opciones(host)).toHaveLength(0);
    escribir(host.querySelector("textarea")!, "55 1234 5678");
    act(() => boton(host, "newChat.question.send")!.click());
    expect(onAnswer).toHaveBeenCalledWith([{ id: "tel", selected: [], custom: "55 1234 5678" }]);
  });

  it("dos preguntas: no se manda hasta contestar las dos", () => {
    const onAnswer = vi.fn();
    const host = montar({
      questions: [plazo, { id: "envio", question: "¿Envías a todo el país?", options: [{ label: "Sí" }, { label: "No" }] }],
      onAnswer,
    });
    const enviar = boton(host, "newChat.question.send")!;
    act(() => opciones(host)[1]!.click());
    expect(onAnswer).not.toHaveBeenCalled();
    expect(enviar.disabled).toBe(true);
    act(() => opciones(host)[2]!.click());
    act(() => enviar.click());
    expect(onAnswer).toHaveBeenCalledWith([
      { id: "plazo", selected: ["Una semana"] },
      { id: "envio", selected: ["Sí"] },
    ]);
  });

  it("contestada, se encoge a una línea", () => {
    const host = montar({ questions: [plazo], answer: "48 horas", onAnswer: () => undefined });
    expect(host.textContent).toContain("newChat.question.answered(48 horas)");
    expect(opciones(host)).toHaveLength(0);
  });

  it("sin quien conteste (una fila vieja), la pregunta y la pista de contestar abajo", () => {
    const host = montar({});
    expect(host.textContent).toContain("¿Cuánto tarda la entrega?");
    expect(host.textContent).toContain("newChat.question.hint");
  });

  it("no se manda dos veces: tras el primer toque, las opciones se apagan", () => {
    const onAnswer = vi.fn();
    const host = montar({ questions: [plazo], onAnswer });
    act(() => opciones(host)[0]!.click());
    act(() => opciones(host)[1]!.click());
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });
});
