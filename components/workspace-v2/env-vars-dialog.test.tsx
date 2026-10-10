// @vitest-environment jsdom
//
// El diálogo de las variables de entorno (spec local 2026-10-10), con los
// textos REALES en español —una clave que falte rompe la prueba— y el `fetch`
// de mentira: qué pide y qué enseña. Arnés de react-dom + act(), como
// database-view.test.tsx. ModalShell pinta en document.body (portal).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/es/topbar.json";
import { EnvVarsDialog } from "./env-vars-dialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const F = "2026-10-10T00:00:00.000Z";
const ESTADO = {
  vars: [
    { name: "VITE_STRIPE", target: "draft", value: "pk_test_1", updatedAt: F },
    { name: "VITE_STRIPE", target: "production", value: "pk_live_1", updatedAt: F },
    { name: "VITE_MAPS", target: "draft", value: "AIza1", updatedAt: F },
    { name: "VITE_MAPS", target: "production", value: "AIza1", updatedAt: F },
  ],
  fromFile: [{ name: "VITE_STRIPE", value: "del-fichero", overridden: ["draft", "production"] }],
  platform: [{ name: "VITE_SUPABASE_URL", value: "https://abc.openlen.app" }],
  version: "v1",
  published: true,
  pendingPublish: true,
};

type Call = { method: string; body: unknown };
let calls: Call[];
let respuestaPut: { status: number; body: unknown };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  calls = [];
  respuestaPut = { status: 200, body: { ...ESTADO, version: "v2", pendingPublish: false } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const r = method === "PUT" ? respuestaPut : { status: 200, body: ESTADO };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const text = () => document.body.textContent ?? "";
const button = (label: string) =>
  [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const inputs = (label: string) => [...document.body.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`)];

async function click(el: Element | undefined | null) {
  if (!el) throw new Error("no está");
  await act(async () => { (el as HTMLElement).click(); });
  await settle();
}

async function type(el: Element | undefined | null, value: string) {
  if (!el) throw new Error("no está");
  const input = el as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function render(props: { readOnly?: boolean; onPublish?: () => void } = {}) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ topbar: messages }}>
        <EnvVarsDialog projectId="p1" open onClose={() => {}} {...props} />
      </NextIntlClientProvider>,
    );
  });
  await settle();
}

describe("EnvVarsDialog", () => {
  it("las tres fuentes; los valores ocultos hasta pedirlos; la franja de publicar", async () => {
    const onPublish = vi.fn();
    await render({ onPublish });
    expect(document.querySelectorAll("[data-env-group]")).toHaveLength(3);
    expect(text()).not.toContain("pk_test_1");
    await click(document.querySelector('[data-env-group="VITE_MAPS"] button[aria-label="Ver el valor"]'));
    expect(text()).toContain("AIza1");
    expect(text()).toContain("La tuya la sustituye en Borrador, Producción");
    expect(text()).toContain("https://abc.openlen.app");
    expect(text()).toContain("Tu app publicada sigue con los valores de antes.");
    await click(button("Publicar"));
    expect(onPublish).toHaveBeenCalled();
  });

  it("añadir: el «¿Querías decir…?», los dos entornos, el valor limpio y la versión que leyó", async () => {
    await render();
    await click(button("Añadir variable"));
    await type(inputs("Nombre")[0], "maps key");
    expect(text()).toContain("¿Querías decir VITE_MAPS_KEY?");
    await click(button("Usar ese"));
    await type(inputs("Valor")[0], "  AIza2 ");
    await click(button("Guardar"));
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
      version: "v1",
      vars: [
        { name: "VITE_STRIPE", target: "draft", value: "pk_test_1" },
        { name: "VITE_STRIPE", target: "production", value: "pk_live_1" },
        { name: "VITE_MAPS", target: "draft", value: "AIza1" },
        { name: "VITE_MAPS", target: "production", value: "AIza1" },
        { name: "VITE_MAPS_KEY", target: "draft", value: "AIza2" },
        { name: "VITE_MAPS_KEY", target: "production", value: "AIza2" },
      ],
    });
    expect(document.querySelector("[data-env-form]")).toBeNull();
  });

  it("🔴 un valor que parece secreto no se guarda sin «Entiendo que será público», y viaja con el acuse", async () => {
    await render();
    await click(button("Añadir variable"));
    await type(inputs("Nombre")[0], "VITE_STRIPE_SK");
    await type(inputs("Valor")[0], "sk_live_51H8abcdefghijklmnop");
    expect(text()).toContain("Esto parece una clave secreta de Stripe.");
    expect((button("Guardar") as HTMLButtonElement).disabled).toBe(true);
    await click(document.querySelector('[data-env-secreto] input[type="checkbox"]'));
    expect((button("Guardar") as HTMLButtonElement).disabled).toBe(false);
    await click(button("Guardar"));
    const put = calls.find((c) => c.method === "PUT")?.body as { vars: { name: string; acknowledgedPublic?: boolean }[] };
    expect(put.vars.filter((v) => v.name === "VITE_STRIPE_SK").map((v) => v.acknowledgedPublic)).toEqual([true, true]);
  });

  it("pegar un .env en Nombre lo reparte en líneas", async () => {
    await render();
    await click(button("Añadir variable"));
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", { value: { getData: () => 'VITE_A=1\nVITE_B="dos"\n' } });
    await act(async () => { inputs("Nombre")[0]!.dispatchEvent(ev); });
    expect(inputs("Nombre").map((i) => i.value)).toEqual(["VITE_A", "VITE_B"]);
    expect(inputs("Valor").map((i) => i.value)).toEqual(["1", "dos"]);
  });

  it("🔴 409: avisa, recarga la lista y no pierde lo escrito", async () => {
    respuestaPut = { status: 409, body: { error: "conflict", ...ESTADO, version: "v9" } };
    await render();
    await click(button("Añadir variable"));
    await type(inputs("Nombre")[0], "VITE_NUEVA");
    await type(inputs("Valor")[0], "1");
    await click(button("Guardar"));
    expect(text()).toContain("Alguien cambió las variables mientras tanto");
    expect(inputs("Nombre")[0]!.value).toBe("VITE_NUEVA");
  });

  it("un lector ve la lista sin botones de cambiar", async () => {
    await render({ readOnly: true });
    expect(button("Añadir variable")).toBeUndefined();
    expect(document.querySelector('button[aria-label^="Borrar"]')).toBeNull();
    expect(text()).toContain("Puedes verlas; las cambian el dueño y los editores.");
  });
});
