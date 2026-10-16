// @vitest-environment jsdom
//
// What the owner sees of the security review, with the REAL Spanish texts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import modalsDomain from "@/messages/es/modalsDomain.json";
import type { Finding, ReviewView } from "@/lib/security-review/types";

import { SecurityPanel, fixRequestText } from "./security-findings";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const rls: Finding = { key: "rls_disabled:public.productos", source: "rule", severity: "HIGH", category: "rls_disabled", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { table: "productos" } };
const secretInVar: Finding = { key: "k2", source: "rule", severity: "HIGH", category: "secret_in_client", file: null, line: null, description: "", exploitScenario: "", recommendation: "", params: { provider: "Stripe", variable: "VITE_PAGOS" } };
const model: Finding = { key: "k3", source: "model", severity: "HIGH", category: "missing_webhook_signature", file: "/supabase/functions/w/index.ts", line: 12, description: "El webhook no comprueba la firma de Stripe", exploitScenario: "Cualquiera marca pedidos como pagados", recommendation: "Verifica la firma" };
const testKey: Finding = { key: "k4", source: "rule", severity: "MEDIUM", category: "test_secret_in_client", file: "/js/p.js", line: 4, description: "", exploitScenario: "", recommendation: "", params: { provider: "Stripe" } };
const v = (over: Partial<ReviewView>): ReviewView => ({ fingerprint: "f".repeat(64), status: "done", blocking: [], medium: [], accepted: [], ...over });

async function render(props: Parameters<typeof SecurityPanel>[0]) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ modalsDomain }}>
        <SecurityPanel {...props} />
      </NextIntlClientProvider>,
    );
  });
}
const button = (label: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);

describe("SecurityPanel", () => {
  it("while running it only says so", async () => {
    await render({ view: v({ status: "running", blocking: [rls] }), busy: false });
    expect(host.textContent).toBe("Revisando la seguridad…");
  });

  it("what blocks, in red, with what can happen, how to fix it and the two buttons", async () => {
    const onPublishAnyway = vi.fn();
    const onFixWithLen = vi.fn();
    await render({ view: v({ blocking: [rls, secretInVar, model] }), busy: false, onPublishAnyway, onFixWithLen });
    const t = host.textContent ?? "";
    expect(t).toContain("3 problemas de seguridad frenan la publicación");
    expect(t).toContain("La tabla productos no tiene RLS");
    expect(t).toContain("Qué puede pasar: Cualquiera con la clave pública de la página puede leer, cambiar y borrar todas sus filas.");
    expect(t).toContain("Una clave secreta de Stripe llega al navegador");
    expect(t).toContain("en la variable VITE_PAGOS");
    expect(t).toContain("El webhook no comprueba la firma de Stripe");
    expect(t).toContain("/supabase/functions/w/index.ts:12");
    expect(t).toContain("Cómo arreglarlo: Verifica la firma");
    act(() => button("Publicar igual")!.click());
    act(() => button("Arreglar con Len")!.click());
    expect(onPublishAnyway).toHaveBeenCalledOnce();
    expect(onFixWithLen).toHaveBeenCalledOnce();
  });

  it("warnings only: amber, and no button to publish anyway", async () => {
    await render({ view: v({ medium: [testKey] }), busy: false, onPublishAnyway: () => {} });
    expect(host.textContent).toContain("Avisos de seguridad");
    expect(host.textContent).toContain("Una clave de prueba de Stripe llega al navegador");
    expect(button("Publicar igual")).toBeUndefined();
  });

  it("clean when done with nothing; a grey line when only the rules ran", async () => {
    await render({ view: v({}), busy: false });
    expect(host.textContent).toContain("Sin problemas de seguridad");
    await render({ view: v({ status: "skipped_scope" }), busy: false });
    expect(host.textContent).toContain("este proyecto no tiene base de datos ni funciones");
    expect(host.textContent).not.toContain("Sin problemas de seguridad");
  });
});

describe("fixRequestText", () => {
  it("the header and one line per blocking finding, with where", () => {
    const t = (k: string, vals?: Record<string, string | number>) => {
      const map: Record<string, string> = { fixRequest: "Arregla:", "rules.rls_disabled.title": `Tabla ${vals?.table} sin RLS`, inVariable: `en ${vals?.name}` };
      return map[k] ?? k;
    };
    expect(fixRequestText(v({ blocking: [rls, model] }), t)).toBe("Arregla:\n- Tabla productos sin RLS\n- El webhook no comprueba la firma de Stripe (/supabase/functions/w/index.ts:12)");
  });
});
