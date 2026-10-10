// @vitest-environment jsdom
//
// La marca «Datos de prueba» del lienzo (spec local 2026-10-09): con base de
// datos, el lienzo usa la de pruebas, y se dice. Textos REALES en español.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import wsChrome from "@/messages/es/wsChrome.json";
import { TestDataBadge } from "./test-data-badge";

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

async function render(show: boolean) {
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="es" messages={{ wsChrome }}>
        <TestDataBadge show={show} />
      </NextIntlClientProvider>,
    );
  });
}

describe("la marca de datos de prueba", () => {
  it("con base de datos, el lienzo dice que usa datos de prueba", async () => {
    await render(true);
    expect(host.textContent).toBe("Datos de prueba");
    expect(host.querySelector("span")?.getAttribute("title")).toBe("El lienzo usa los datos de prueba; los reales sólo los usa la publicada.");
  });

  it("sin base de datos, nada", async () => {
    await render(false);
    expect(host.textContent).toBe("");
  });
});
