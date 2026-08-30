import { act } from "react";
import { CENTICREDITOS_POR_CREDITO } from "@/lib/credits-client";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CREDIT_BALANCE_CHANGED_EVENT } from "@/lib/credits-client";
import { CreditPill } from "./credit-pill";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useLocale: () => "es",
  useTranslations: () =>
    (key: string, values?: Record<string, string | number>) => {
      if (key === "creditPill.tooltip") {
        return `Te quedan ${values?.balance} de ${values?.allotment} créditos de IA`;
      }
      if (key === "creditPill.low") return "Pocos créditos";
      if (key === "creditPill.empty") return "Sin créditos";
      if (key === "creditPill.refillsAt") return `Se renuevan el ${values?.date}`;
      return key;
    },
}));

interface UsageCredits {
  balance: number;
  allotment: number;
  refillsAt: string;
}

const roots: Root[] = [];

function response(credits: UsageCredits) {
  return {
    ok: true,
    json: async () => ({ credits }),
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function renderPill(credits: UsageCredits): Promise<HTMLElement> {
  vi.stubGlobal("fetch", vi.fn(async () => response(credits)));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<CreditPill />));
  await flushEffects();
  return container;
}

// EN CRÉDITOS, como se leen los casos — y se convierte a la unidad que manda
// la API, que son centicréditos. Sin esta conversión `usage(3)` significaría
// 0,03 créditos y los umbrales medirían otra cosa.
const usage = (creditos: number): UsageCredits => ({
  balance: creditos * CENTICREDITOS_POR_CREDITO,
  allotment: 20 * CENTICREDITOS_POR_CREDITO,
  refillsAt: "2026-09-23T12:00:00.000Z",
});

afterEach(() => {
  roots.splice(0).forEach((root) => act(() => root.unmount()));
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CreditPill", () => {
  it("4 créditos siguen en estado normal y el contador ya no se oculta en móvil", async () => {
    const container = await renderPill(usage(4));
    const pill = container.querySelector('[data-credit-state="normal"]') as HTMLElement;

    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain("4");
    expect(pill.classList.contains("hidden")).toBe(false);
  });

  it("avisa explícitamente desde 3, sin depender sólo del color", async () => {
    const container = await renderPill(usage(3));
    const pill = container.querySelector('[data-credit-state="low"]') as HTMLElement;

    expect(pill.textContent).toContain("3");
    expect(pill.textContent).toContain("Pocos créditos");
    expect(pill.getAttribute("aria-label")).toContain("Pocos créditos");
    expect(pill.getAttribute("title")).toContain("23 de septiembre de 2026");
    expect(pill.querySelector('[data-credit-mobile="true"]')?.textContent).toBe("3");
    expect(
      pill.querySelector('[data-credit-mobile="true"]')?.classList.contains("sm:hidden"),
    ).toBe(true);
    expect(
      pill.querySelector('[data-credit-desktop="true"]')?.className,
    ).toContain("hidden sm:inline");
  });

  it("a cero se convierte en una salida visible hacia Pro", async () => {
    const container = await renderPill(usage(0));
    const pill = container.querySelector('[data-credit-state="empty"]') as HTMLAnchorElement;

    expect(pill.tagName).toBe("A");
    expect(pill.textContent).toContain("Sin créditos");
    expect(pill.href).toContain("/api/billing/checkout?locale=es");
    expect(pill.querySelector('[data-credit-mobile="true"]')?.textContent).toBe(
      "0 · Pro",
    );
    expect(
      pill.querySelector('[data-credit-mobile="true"]')?.classList.contains("sm:hidden"),
    ).toBe(true);
    expect(
      pill.querySelector('[data-credit-desktop="true"]')?.className,
    ).toContain("hidden sm:inline");
  });

  it("vuelve a consultar el saldo al terminar un turno de IA", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(usage(3)))
      .mockResolvedValueOnce(response(usage(1)));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    act(() => root.render(<CreditPill />));
    await flushEffects();

    expect(container.textContent).toContain("3");
    act(() => window.dispatchEvent(new Event(CREDIT_BALANCE_CHANGED_EVENT)));
    await flushEffects();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("1");
  });
});
