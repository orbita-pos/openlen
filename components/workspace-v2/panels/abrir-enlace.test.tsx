// PROBAR EL DESTINO DESDE EL EDITOR — la guarda del botón.
//
// EL FALLO, dicho por Jesús mirando el producto: «le agrego whatsapp y mi
// número y no se abre; pero si hago el bake sí lo abre, y en el editor se ve
// como que no funcionara».
//
// La causa NO estaba en el enlace. `use-element-inspect` escucha el clic en
// fase de CAPTURA y hace `stopPropagation()` en cuanto hay modo edición
// (`use-element-inspect.ts`), y además se inyecta ANTES que `use-page-links`
// (`preview-area.tsx`), que es quien sabe subir el destino al padre para
// abrirlo. O sea que editando el clic nunca llega — y está BIEN que no llegue:
// editando, un clic en un enlace es para seleccionarlo, no para irse.
//
// Lo que faltaba era la otra mitad: una forma de COMPROBAR el destino. El
// inspector ya mostraba el href y un interruptor de `target="_blank"` —que no
// abre nada, sólo escribe un atributo— así que no había ninguna.
//
// Arnés manual de react-dom + act(), como el resto de las pruebas de componente
// de este repo (aquí no hay @testing-library).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { PropertiesPanel, type InspectSelection } from "./properties-panel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

function seleccionDeEnlace(href: string | undefined): InspectSelection {
  return {
    path: "1/2/3",
    tag: "a",
    hint: "Escríbenos por WhatsApp",
    props: href === undefined ? {} : { href },
    style: {},
  } as InspectSelection;
}

const NADA = () => {};

function montar(seleccion: InspectSelection, onAbrirEnlace?: (href: string) => void) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <PropertiesPanel
        selection={seleccion}
        pageMeta={null}
        formConfig={null}
        onApplyElementProp={NADA}
        onLinkifyButton={NADA}
        {...(onAbrirEnlace ? { onAbrirEnlace } : {})}
        onApplyPageMeta={NADA}
        onApplyFormConfig={NADA}
        onApplyStyle={NADA}
        onResetProps={NADA}
        onSelectPath={NADA}
        onApplyBg={NADA}
        onApplyHide={NADA}
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
    const r = vivo.root;
    act(() => r.unmount());
    vivo.host.remove();
    vivo = null;
  }
});

const botonAbrir = (host: HTMLElement) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("link.tryIt")) ?? null;

describe("probar el destino de un enlace desde el inspector", () => {
  it("🔴 un <a> con destino ofrece abrirlo, y lo abre con ESE destino", () => {
    const abiertos: string[] = [];
    vivo = montar(seleccionDeEnlace("https://wa.me/5215512345678"), (h) => abiertos.push(h));
    const boton = botonAbrir(vivo.host);
    expect(boton, "no hay forma de probar el destino desde el editor").not.toBeNull();
    act(() => {
      boton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(abiertos).toEqual(["https://wa.me/5215512345678"]);
  });

  it("un esquema que no es http viaja IGUAL — es justo el que el lienzo no puede abrir", () => {
    // `tel:` y `mailto:` son los que el sandbox rechaza en silencio; si el botón
    // los filtrara, el arreglo dejaría fuera precisamente el caso que lo pidió.
    const abiertos: string[] = [];
    vivo = montar(seleccionDeEnlace("tel:+525512345678"), (h) => abiertos.push(h));
    act(() => {
      botonAbrir(vivo!.host)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(abiertos).toEqual(["tel:+525512345678"]);
  });

  it("CONTRA-PRUEBA: sin destino no se ofrece — un botón que no lleva a nada es peor que ninguno", () => {
    vivo = montar(seleccionDeEnlace(undefined), NADA);
    expect(botonAbrir(vivo.host)).toBeNull();
  });

  it("CONTRA-PRUEBA: sin el manejador tampoco se pinta — el panel se usa en sitios sin taller", () => {
    vivo = montar(seleccionDeEnlace("https://wa.me/52155"));
    expect(botonAbrir(vivo.host)).toBeNull();
  });
});
