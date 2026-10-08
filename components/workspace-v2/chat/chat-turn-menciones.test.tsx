// LAS MENCIONES EN LA BURBUJA DE QUIEN ESCRIBE: `@Len` en naranja (el acento)
// y cada persona del proyecto en su color, como en los hilos del código.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next-intl", () => ({
  useTranslations: () => (clave: string) => clave,
}));

import { UserMessage } from "./chat-turn";
import { restoreTurn } from "./use-agent-chat";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = "";
});

describe("las menciones en la burbuja del usuario", () => {
  it("🔴 @Len sale como mención de Len y @Leo Lector en su color", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const turn = restoreTurn({ id: "t1", userText: "de acuerdo con @Leo Lector. @Len pon el pie en gris oscuro", assistantReasoning: "", status: "applied", appliedAt: 1 });
    act(() =>
      root.render(<UserMessage turn={turn} initial="D" gente={[{ userId: "u-leo", nombre: "Leo Lector" }]} colorDe={() => "rgb(1, 2, 3)"} />),
    );
    expect(host.querySelector('[data-mencion="len"]')?.textContent).toBe("@Len");
    const leo = host.querySelector<HTMLElement>('[data-mencion="persona"]');
    expect(leo?.textContent).toBe("@Leo Lector");
    expect(leo?.style.color).toBe("rgb(1, 2, 3)");
    expect(host.textContent).toContain("de acuerdo con @Leo Lector. @Len pon el pie en gris oscuro");
  });

  it("sin gente (proyecto sin miembros), @Len también va en naranja", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    const turn = restoreTurn({ id: "t2", userText: "@Len hola", assistantReasoning: "", status: "applied", appliedAt: 1 });
    act(() => root.render(<UserMessage turn={turn} initial="D" />));
    expect(host.querySelector('[data-mencion="len"]')?.textContent).toBe("@Len");
  });
});
