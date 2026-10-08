// La barra de dirección del lienzo. En una APP no hay páginas: sus pantallas
// van por hash y las elige su propio menú, así que la barra no ofrece rutas ni
// crear o borrar páginas (que en una app se rechazan). Mismo arnés de react-dom
// + act() que reference-field.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AddressBar } from "./address-bar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

const roots: Root[] = [];
function render(esApp: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    const root = createRoot(container);
    root.render(
      <AddressBar
        subdomain="cafe"
        baseHost="openlen.app"
        pages={[]}
        activePage={null}
        onSwitch={() => undefined}
        onCreate={async () => null}
        onDelete={async () => false}
        esApp={esApp}
      />,
    );
    roots.push(root);
  });
  return container;
}

afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
  document.body.innerHTML = "";
});

describe("la barra de dirección", () => {
  it("en una página, la ruta y su menú de páginas", () => {
    const c = render(false);
    const boton = c.querySelector("button[aria-haspopup='menu']");
    expect(boton).not.toBeNull();
    expect(boton!.textContent).toContain("/");
  });

  it("🔴 en una app, sólo la dirección: ni rutas que elegir ni páginas que crear", () => {
    const c = render(true);
    expect(c.querySelector("button")).toBeNull();
    expect(c.textContent).toContain("cafe.openlen.app");
    expect(c.textContent).toContain("preview.direccionApp");
  });
});
