// @vitest-environment jsdom
//
// UN MENSAJE ENTRE PERSONAS en el chat del equipo, con los textos REALES en
// español. Arnés manual de react-dom + act(), como `database-view.test.tsx`.
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";

import panelsChat from "@/messages/es/panelsChat.json";
import { MensajeDelEquipo } from "./mensaje-del-equipo";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GENTE = [{ userId: "u-dana", nombre: "Dana Dueña" }, { userId: "u-eli", nombre: "Eli Editor" }];
const turn = { id: "m1", userText: "@Dana Dueña ¿el pie en gris?", assistantReasoning: "", status: "applied", preEditHtml: "", tipo: "persona", autorId: "u-eli", menciones: ["u-dana"] } as never;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("un mensaje entre personas", () => {
  it("🔴 dice quién a quién y que Len no responde; lo ajeno va a la izquierda", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    act(() =>
      root.render(
        <NextIntlClientProvider locale="es" messages={{ panelsChat }}>
          <MensajeDelEquipo turn={turn} gente={GENTE} yo="u-dana" colorDe={() => "red"} />
        </NextIntlClientProvider>,
      ),
    );
    expect([...host.querySelectorAll("p")].some((p) => p.textContent === "Eli Editor → Dana Dueña · Len no responde")).toBe(true);
    expect(host.querySelector('[data-mensaje-del-equipo="ajeno"]')).toBeTruthy();
    expect(host.querySelector('[data-mencion="persona"]')?.textContent).toBe("@Dana Dueña");
  });
});
