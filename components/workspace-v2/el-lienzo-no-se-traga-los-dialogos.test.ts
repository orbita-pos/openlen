// EL LIENZO SE TRAGABA LOS DIÁLOGOS Y HACÍA PARECER MUERTA UNA PÁGINA SANA.
//
// 🔴 EL CASO, medido el 2026-09-15. Un usuario pidió «que me pregunte el nombre
// al crearla y que me pida confirmación antes de borrar». El modelo escribió lo
// correcto —`prompt()` para el nombre, `confirm()` para el borrado— y en el
// taller los dos botones NO HACÍAN NADA.
//
// La causa no era el modelo ni el navegador: era este atributo. En un iframe con
// `sandbox="allow-scripts"` y sin `allow-modals`, Chromium IGNORA la llamada y
// devuelve al instante. Medido con un Chromium controlado:
//
//   sandbox="allow-scripts"               prompt() -> null   confirm() -> false
//                                         diálogos que vio Chromium: 0
//                                         consola: "Ignored call to 'prompt()'.
//                                         The document is sandboxed, and the
//                                         'allow-modals' keyword is not set."
//   sandbox="allow-scripts allow-modals"  diálogos que vio Chromium: 2
//
// Y el código del modelo hace lo CORRECTO con ese null:
//
//     var nombre = prompt('Nombre?');
//     if (nombre === null) return;      // «el usuario canceló» — pero nadie canceló
//
// Botón muerto, sin un solo error en consola. Es la peor forma de fallo que
// tiene este producto: la página publicada FUNCIONA —se sirve como documento
// normal, sin sandbox— y el taller miente sobre ella. El usuario no puede saber
// que lo que ve es mentira, y lo natural es que le pida a Len que arregle algo
// que no está roto.
//
// 🔴 Y NO ERA UNA DECISIÓN, ERA UN OLVIDO. El enlace de vista previa (`/p/`) ya
// manda `allow-modals` desde hace tiempo. Mismo contenido, misma confianza, una
// superficie lo tiene y la otra no — la tercera vez en el mismo día que nos
// muerde esta forma. Por eso esta guarda compara las DOS, en vez de fijar una
// cadena en un sitio.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SANDBOX_LOCAL, SANDBOX_REMOTO } from "./sandbox-del-lienzo";

// ⚠️ DESDE EL 2026-09-15 LAS BANDERAS VIVEN EN `sandbox-del-lienzo.ts`, no en un
// literal de preview-area.tsx: esta guarda lee la constante que el lienzo usa
// de verdad, en vez de adivinarla con una expresión regular sobre el JSX.

const RAIZ = join(import.meta.dirname, "..", "..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");
const banderas = (s: string) => s.split(/\s+/);

/** El del ENLACE DE VISTA PREVIA, que va por cabecera CSP y no por atributo. */
function sandboxDelEnlace(): string {
  const m = /const PREVIEW_CSP = "sandbox ([^"]+)"/.exec(fuente("app/p/[id]/route.ts"));
  expect(m, "el enlace de vista previa dejó de declarar su CSP").not.toBeNull();
  return m![1]!;
}

describe("el lienzo no se traga los diálogos", () => {
  it("🔴 deja correr alert/confirm/prompt, en los dos modos", () => {
    expect(banderas(SANDBOX_LOCAL)).toContain("allow-modals");
    expect(banderas(SANDBOX_REMOTO)).toContain("allow-modals");
  });

  it("y el lienzo y el enlace de vista previa NO pueden discrepar en esto", () => {
    expect(banderas(SANDBOX_LOCAL).includes("allow-modals")).toBe(sandboxDelEnlace().includes("allow-modals"));
  });

  it("el lienzo usa las constantes, no un literal propio", () => {
    const src = fuente("components/workspace-v2/preview-area.tsx");
    expect(src).toContain('from "./sandbox-del-lienzo"');
    expect(src, "un sandbox escrito a mano en el JSX vuelve a poder discrepar").not.toMatch(/sandbox="allow-/);
  });
});

describe("🔴 allow-same-origin: la frontera de verdad", () => {
  it("el modo LOCAL (srcdoc, mismo sitio que la app) NUNCA la lleva", () => {
    // Un srcdoc hereda el origen de openlen.com. Con allow-same-origin, el
    // JavaScript del modelo alcanzaría cookies, localStorage y el DOM del padre:
    // el agujero de la auditoría del 2026-07-29.
    expect(banderas(SANDBOX_LOCAL)).not.toContain("allow-same-origin");
  });

  it("el modo REMOTO la lleva porque su src es OTRO sitio (lienzo-<id>)", () => {
    // Es lo que hacen la acción `preview` de Claude Code (su Nb) y v0: con la
    // página en otro sitio, allow-same-origin da a la página SU origen, no el
    // de la app. Que ese src sea siempre un host lienzo-* lo fija
    // lib/lienzo/host.test.ts y la Task 10 de este plan.
    expect(banderas(SANDBOX_REMOTO)).toContain("allow-same-origin");
    expect(banderas(SANDBOX_REMOTO), "navegar la ventana de arriba sacaría al usuario del taller").not.toContain(
      "allow-top-navigation",
    );
  });

  it("CONTRA-PRUEBA: las MINIATURAS siguen sin poder abrir diálogos", () => {
    for (const ruta of [
      "components/workspace-v2/panels/versions-panel.tsx",
      "components/workspace-v2/panels/pages-panel.tsx",
      "components/workspace-v2/marketing-view.tsx",
      "components/workspace-v2/original-restore-modal.tsx",
    ]) {
      for (const [, valor] of fuente(ruta).matchAll(/sandbox="([^"]+)"/g)) {
        expect(banderas(valor), `${ruta}: una miniatura no abre diálogos`).not.toContain("allow-modals");
      }
    }
  });
});
