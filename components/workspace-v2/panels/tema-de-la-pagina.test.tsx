// EL PANEL NO OFRECE LO QUE LA PÁGINA NO LEE.
//
// El iframe mide qué variables lee la página (`descubrirTema` en
// use-element-inspect.ts) y lo manda como `pageMeta.tema`. Un control cuyo
// papel no está en ninguna variable no cambiaría nada en la página guardada:
// antes el lienzo lo fingía con un CSS forzado que no se guardaba. Ahora el
// dial no aparece y el panel dice qué pedirle a Len. La prueba de que la
// medida es correcta vive en `el-tema-sigue-a-la-pagina.browser.test.ts`; aquí
// sólo que el panel la obedece.
//
// Arnés manual de react-dom + act(), como el resto de las pruebas de componente
// de este repo (aquí no hay @testing-library).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { PropertiesPanel, type PageMeta, type TemaDePagina } from "./properties-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// La clave, y los parámetros a la vista: así se ve qué nombra el aviso.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const NADA = () => {};

function meta(tema?: TemaDePagina): PageMeta {
  return { title: "", description: "", ogImage: "", favicon: "", mode: "light", hasDark: false, ...(tema ? { tema } : {}) };
}

function montar(pageMeta: PageMeta) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <PropertiesPanel
        selection={null}
        pageMeta={pageMeta}
        formConfig={null}
        onApplyElementProp={NADA}
        onLinkifyButton={NADA}
        onApplyPageMeta={NADA}
        onApplyFormConfig={NADA}
        onApplyStyle={NADA}
        onResetProps={NADA}
        onSelectPath={NADA}
        onApplyBg={NADA}
        onApplyHide={NADA}
        onApplyLook={NADA}
        onApplyThemeToken={NADA}
        onApplyFontPair={NADA}
        onClearSelection={NADA}
        onClose={NADA}
      />,
    );
  });
  return { host, root };
}

let vivo: { host: HTMLElement; root: Root } | null = null;
afterEach(() => {
  if (vivo) {
    act(() => vivo!.root.unmount());
    vivo.host.remove();
    vivo = null;
  }
});

describe("el panel sigue lo que la página lee", () => {
  it("letra y densidad no están: no hay dial, y el aviso las nombra", () => {
    vivo = montar(meta({ colores: true, fuentes: true, radio: true, letra: false, densidad: false }));
    const texto = vivo.host.textContent ?? "";
    // Los diales se reconocen por sus opciones: el nombre sale también en el aviso.
    expect(texto).not.toContain("XL");
    expect(texto).not.toContain("spacing.densities");
    expect(texto).toContain("style.cornersSteps.square");
    expect(texto).toContain('design.pideleALen:{"que":"design.typeScale, design.density"}');
    // Los colores sí: están los Looks, no el aviso.
    expect(texto).not.toContain("theme.sinVariables");
  });

  it("colores escritos a mano: sin Looks, y el panel lo dice", () => {
    vivo = montar(meta({ colores: false, fuentes: false, radio: false, letra: false, densidad: false }));
    const texto = vivo.host.textContent ?? "";
    expect(texto).toContain("theme.sinVariables");
    expect(texto).not.toContain("theme.generator");
    expect(texto).toContain(
      'design.pideleALen:{"que":"design.typeScale, design.density, design.corners, design.fonts"}',
    );
  });

  it("un iframe viejo sin `tema`: se enseña todo, como antes", () => {
    vivo = montar(meta());
    const texto = vivo.host.textContent ?? "";
    expect(texto).toContain("XL");
    expect(texto).toContain("spacing.densities.compact");
    expect(texto).toContain("style.cornersSteps.square");
    expect(texto).not.toContain("design.pideleALen");
    expect(texto).not.toContain("theme.sinVariables");
  });
});
