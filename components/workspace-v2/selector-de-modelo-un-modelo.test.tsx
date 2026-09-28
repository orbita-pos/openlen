import { afterEach, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ESCRITORES_ELEGIBLES } from "@/lib/ai/provider-switch";
import { modelIdForRole } from "@/lib/generation/model-policy";

import { SelectorDeModelo } from "./selector-de-modelo";

// 🔴 UNA ELECCIÓN ENTRE DOS OPCIONES IGUALES ES UNA PALANCA QUE NO VA A NINGÚN
// SITIO. El 2026-09-26 el papel `reasoner` pasó a V4.1 Flash —Fireworks sacó V4
// Flash de serverless—, y los dos escritores de Crear quedaron en el MISMO
// modelo al MISMO precio: el selector habría enseñado dos filas «DeepSeek V4.1
// Flash» para elegir nada. Con la política REAL: hoy no se pinta. El día que los
// papeles vuelvan a diferir, vuelve solo (y las filas las sujeta
// `selector-de-modelo.test.tsx`, que simula dos modelos).

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
});

it("con los dos escritores en el mismo modelo, no hay nada que elegir: queda el nombre, sin menú", () => {
  // La premisa, comprobada: si algún día difieren, esta prueba lo dice.
  expect(new Set(ESCRITORES_ELEGIBLES.map(modelIdForRole)).size).toBe(1);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <SelectorDeModelo escritor={null} hasImages={false} onChange={() => undefined} abierto onAbrir={() => undefined} t={(c) => c} />,
    );
  });
  // El nombre de quien escribe se queda (la bienvenida de Claude Code)…
  expect(host.textContent).toBe("DeepSeek V4.1 Flash");
  // …y lo que se va es el mando: ni botón ni menú.
  expect(host.querySelector("button")).toBeNull();
  expect(host.querySelector("[role=menu]")).toBeNull();
});
