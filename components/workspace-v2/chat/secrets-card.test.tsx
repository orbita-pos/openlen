// LA TARJETA SEGURA (spec local 2026-10-11, Parte 4): dos campos por secreto,
// los valores a la ruta de secretos y al turno SÓLO nombres.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { QuestionAnswer, UserQuestion } from "@/lib/agent/ask-user-question";
import { QuestionCardView } from "./question-card";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const t = (clave: string, valores?: Record<string, string>) => (valores ? `${clave}(${Object.values(valores).join(",")})` : clave);
const PREGUNTA: UserQuestion[] = [
  { id: "secrets", question: "Enter…", intent: { kind: "secrets", secrets: [{ name: "STRIPE_SECRET_KEY", description: "Para cobrar", url: "https://dashboard.stripe.com/test/apikeys" }] } },
];
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function montar(o: { answer?: string | null; onAnswer?: (a: QuestionAnswer[]) => void } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<QuestionCardView question="" questions={PREGUNTA} answer={o.answer ?? null} projectId="p1" t={t} onAnswer={o.onAnswer ?? (() => {})} />));
  return host;
}

function servidor(status = 200, body: unknown = { ok: true }) {
  const llamadas: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    llamadas.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }));
  return llamadas;
}

const campos = (host: HTMLElement) => [...host.querySelectorAll("input")] as HTMLInputElement[];
const boton = (host: HTMLElement, texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto)!;
const escribir = (el: HTMLInputElement, valor: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("la tarjeta de los secretos", () => {
  it("dos campos por secreto, de contraseña y sin autocompletar, con para qué y dónde sacarlo", () => {
    const host = montar();
    const [borrador, publicada] = campos(host);
    expect(campos(host)).toHaveLength(2);
    for (const c of [borrador!, publicada!]) {
      expect(c.type).toBe("password");
      expect(c.getAttribute("autocomplete")).toBe("off");
    }
    expect(host.textContent).toContain("Para cobrar");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("https://dashboard.stripe.com/test/apikeys");
  });

  it("🔴 el valor va a la ruta de secretos y al turno SÓLO el nombre", async () => {
    const llamadas = servidor();
    const respuestas: QuestionAnswer[][] = [];
    const host = montar({ onAnswer: (a) => respuestas.push(a) });
    const [borrador, publicada] = campos(host);
    escribir(borrador!, "sk_test_valor123456");
    escribir(publicada!, "sk_live_valor123456");
    await act(async () => boton(host, "functionSecrets.save").click());
    await settle();
    expect(llamadas).toEqual([{
      url: "/api/projects/p1/function-secrets",
      body: { secrets: [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_valor123456" }, { environment: "live", name: "STRIPE_SECRET_KEY", value: "sk_live_valor123456" }] },
    }]);
    expect(respuestas).toEqual([[{ id: "secrets", selected: ["STRIPE_SECRET_KEY:draft", "STRIPE_SECRET_KEY:live"] }]]);
    expect(JSON.stringify(respuestas)).not.toContain("valor123456");
  });

  it("🔴 recorta los espacios (un salto de línea al copiar rompe la clave); producción se puede dejar", async () => {
    const llamadas = servidor();
    const respuestas: QuestionAnswer[][] = [];
    const host = montar({ onAnswer: (a) => respuestas.push(a) });
    escribir(campos(host)[0]!, "  sk_test_valor123456\n");
    await act(async () => boton(host, "functionSecrets.save").click());
    await settle();
    expect(llamadas[0]!.body).toEqual({ secrets: [{ environment: "draft", name: "STRIPE_SECRET_KEY", value: "sk_test_valor123456" }] });
    expect(respuestas[0]).toEqual([{ id: "secrets", selected: ["STRIPE_SECRET_KEY:draft"] }]);
  });

  it("avisa de una clave real en el borrador y de una de prueba en producción, sin impedir", () => {
    const host = montar();
    const [borrador, publicada] = campos(host);
    escribir(borrador!, "sk_live_51H8abcdefghijklmnop");
    escribir(publicada!, "sk_test_51H8abcdefghijklmnop");
    expect(host.textContent).toContain("functionSecrets.liveInDraft");
    expect(host.textContent).toContain("functionSecrets.testInLive");
    expect(boton(host, "functionSecrets.save").disabled).toBe(false);
  });

  it("si la ruta dice que no cabe, la tarjeta se queda con lo que queda y NO contesta", async () => {
    servidor(422, { error: "env_too_large", environment: "live", availableVars: 120 });
    const respuestas: QuestionAnswer[][] = [];
    const host = montar({ onAnswer: (a) => respuestas.push(a) });
    escribir(campos(host)[1]!, "x".repeat(50));
    await act(async () => boton(host, "functionSecrets.save").click());
    await settle();
    expect(host.textContent).toContain("functionSecrets.tooLarge(120,functionSecrets.envLive)");
    expect(respuestas).toEqual([]);
  });

  it("«Ahora no» contesta sin guardar nada", async () => {
    const llamadas = servidor();
    const respuestas: QuestionAnswer[][] = [];
    const host = montar({ onAnswer: (a) => respuestas.push(a) });
    await act(async () => boton(host, "functionSecrets.skip").click());
    expect(llamadas).toEqual([]);
    expect(respuestas).toEqual([[{ id: "secrets", selected: [] }]]);
  });

  it("contestada: lo guardado, con los entornos en el idioma del dueño; sin nada, que no guardó", () => {
    expect(montar({ answer: "STRIPE_SECRET_KEY:draft, STRIPE_SECRET_KEY:live" }).textContent).toContain(
      "functionSecrets.answered(STRIPE_SECRET_KEY (functionSecrets.envDraft, functionSecrets.envLive))",
    );
    expect(montar({ answer: "" }).textContent).toContain("functionSecrets.skipped");
    expect(montar({ answer: "STRIPE_SECRET_KEY guardado en: borrador" }).textContent).toContain("STRIPE_SECRET_KEY guardado en: borrador");
  });
});
