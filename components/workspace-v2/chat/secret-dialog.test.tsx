// «Guardar como secreto» (spec local 2026-10-11, Parte 4): el nombre de los
// ejemplos de Supabase, el valor ya puesto en su entorno, y a la ruta.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { SecretInput } from "@/lib/workspace-v2/function-secrets-request";
import { SecretDialogView } from "./secret-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});
const t = (k: string) => k;

function montar(value: string, o: { save?: (p: string, s: readonly SecretInput[]) => Promise<{ kind: "saved" }>; onSaved?: (n: string) => void } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() =>
    root.render(
      <SecretDialogView projectId="p1" found={{ value, kind: "stripe", start: 0, end: value.length }} onSaved={o.onSaved ?? (() => {})} onClose={() => {}} save={o.save ?? (async () => ({ kind: "saved" as const }))} t={t} />,
    ),
  );
  return host;
}
const campos = (host: HTMLElement) => [...host.querySelectorAll("input")] as HTMLInputElement[];
const boton = (host: HTMLElement, texto: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto)!;
const escribir = (el: HTMLInputElement, valor: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});

describe("SecretDialogView", () => {
  it("propone el nombre y pone una clave de prueba en el borrador; una real, en producción", () => {
    const [nombre, borrador, publicada] = campos(montar("sk_test_51H8abcdefghijklmnop"));
    expect(nombre!.value).toBe("STRIPE_SECRET_KEY");
    expect(borrador!.value).toBe("sk_test_51H8abcdefghijklmnop");
    expect(publicada!.value).toBe("");
    const [, b2, p2] = campos(montar("sk_live_51H8abcdefghijklmnop"));
    expect(b2!.value).toBe("");
    expect(p2!.value).toBe("sk_live_51H8abcdefghijklmnop");
  });

  it("guarda con el nombre elegido y avisa a quien lo abrió", async () => {
    const guardados: SecretInput[][] = [];
    const nombres: string[] = [];
    const host = montar("sk_test_51H8abcdefghijklmnop", { save: async (_p, s) => (guardados.push([...s]), { kind: "saved" as const }), onSaved: (n) => nombres.push(n) });
    escribir(campos(host)[0]!, "stripe_test");
    await act(async () => boton(host, "functionSecrets.save").click());
    expect(guardados).toEqual([[{ environment: "draft", name: "STRIPE_TEST", value: "sk_test_51H8abcdefghijklmnop" }]]);
    expect(nombres).toEqual(["STRIPE_TEST"]);
  });

  it("un nombre que no vale no se guarda", async () => {
    const save = vi.fn(async () => ({ kind: "saved" as const }));
    const host = montar("sk_test_51H8abcdefghijklmnop", { save });
    escribir(campos(host)[0]!, "SUPABASE_KEY");
    await act(async () => boton(host, "functionSecrets.save").click());
    expect(save).not.toHaveBeenCalled();
    expect(host.textContent).toContain("functionSecrets.invalidName");
  });
});
