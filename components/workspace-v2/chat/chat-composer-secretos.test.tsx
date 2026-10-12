// EDGE FUNCTIONS (spec local 2026-10-11, Parte 4): lo que parece una clave
// secreta no sale hacia Len sin preguntar — «Guardar como secreto» o «Mandar igual».
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({ useTranslations: () => (clave: string) => clave }));

import type { FoundSecret } from "@/lib/apps/env/secret-patterns";
import { ChatComposer } from "./chat-composer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

function Compositor(p: { value: string; onSubmit: () => void; guard?: { available(): Promise<boolean>; onSaveAsSecret(f: FoundSecret): void } }) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  return (
    <ChatComposer
      value={p.value}
      onChange={() => {}}
      onSubmit={p.onSubmit}
      onStop={() => {}}
      busy={false}
      textareaRef={ta}
      comments={[]}
      onRemoveComment={() => {}}
      scopedSelection={null}
      sectionSelectMode={false}
      attachedImage={null}
      onAttachImage={() => {}}
      onClearAttachedImage={() => {}}
      effort="auto"
      effortLevels={["low", "medium", "high"]}
      effortResolvesTo="medium"
      onEffortChange={() => {}}
      mode="len"
      {...(p.guard ? { secretGuard: p.guard } : {})}
    />
  );
}

function montar(p: Parameters<typeof Compositor>[0]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Compositor {...p} />));
  return host;
}
const enviar = async (host: HTMLElement) => {
  await act(async () => (host.querySelector('button[aria-label="composer.send"]') as HTMLButtonElement).click());
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const boton = (host: HTMLElement, texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
const CLAVE = "sk_live_51H8abcdefghijklmnop";

describe("el compositor con una clave dentro", () => {
  it("🔴 no la manda: pregunta, y «Mandar igual» la manda", async () => {
    const onSubmit = vi.fn();
    const host = montar({ value: `mi clave es ${CLAVE}`, onSubmit, guard: { available: async () => true, onSaveAsSecret: () => {} } });
    await enviar(host);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(host.textContent).toContain("functionSecrets.composerFound");
    await act(async () => boton(host, "functionSecrets.sendAnyway")!.click());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("«Guardar como secreto» abre la tarjeta con lo que encontró", async () => {
    const vistos: FoundSecret[] = [];
    const host = montar({ value: `mi clave es ${CLAVE}`, onSubmit: vi.fn(), guard: { available: async () => true, onSaveAsSecret: (f) => vistos.push(f) } });
    await enviar(host);
    await act(async () => boton(host, "functionSecrets.saveAsSecret")!.click());
    expect(vistos).toMatchObject([{ kind: "stripe", value: CLAVE, start: 12 }]);
    expect(host.textContent).not.toContain("functionSecrets.composerFound");
  });

  it("sin clave, o sin funciones en el servidor, o sin guarda, sale como siempre", async () => {
    const a = vi.fn();
    await enviar(montar({ value: "hazme una tienda", onSubmit: a, guard: { available: async () => true, onSaveAsSecret: () => {} } }));
    expect(a).toHaveBeenCalledTimes(1);
    const b = vi.fn();
    await enviar(montar({ value: `mi clave es ${CLAVE}`, onSubmit: b, guard: { available: async () => false, onSaveAsSecret: () => {} } }));
    expect(b).toHaveBeenCalledTimes(1);
    const c = vi.fn();
    await enviar(montar({ value: `mi clave es ${CLAVE}`, onSubmit: c }));
    expect(c).toHaveBeenCalledTimes(1);
  });
});
