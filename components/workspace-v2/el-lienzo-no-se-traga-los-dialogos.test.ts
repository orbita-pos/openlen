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

const RAIZ = join(import.meta.dirname, "..", "..");
const fuente = (ruta: string) => readFileSync(join(RAIZ, ruta), "utf8");

/** El sandbox del LIENZO — el iframe con el que el usuario prueba su página. */
function sandboxDelLienzo(): string {
  const texto = fuente("components/workspace-v2/preview-area.tsx");
  const m = /sandbox="([^"]+)"/.exec(texto);
  expect(m, "el lienzo dejó de declarar sandbox").not.toBeNull();
  return m![1]!;
}

/** El del ENLACE DE VISTA PREVIA, que va por cabecera CSP y no por atributo. */
function sandboxDelEnlace(): string {
  const m = /const PREVIEW_CSP = "sandbox ([^"]+)"/.exec(fuente("app/p/[id]/route.ts"));
  expect(m, "el enlace de vista previa dejó de declarar su CSP").not.toBeNull();
  return m![1]!;
}

describe("el lienzo no se traga los diálogos", () => {
  it("🔴 deja correr alert/confirm/prompt", () => {
    expect(
      sandboxDelLienzo().split(/\s+/),
      "sin allow-modals el navegador ignora prompt() y el botón del usuario muere sin un error",
    ).toContain("allow-modals");
  });

  it("y el lienzo y el enlace de vista previa NO pueden discrepar en esto", () => {
    // La misma página, dos superficies. Que una enseñe el diálogo y la otra no
    // es exactamente lo que pasó, y nadie lo vio hasta que un usuario lo contó.
    const lienzo = sandboxDelLienzo().includes("allow-modals");
    const enlace = sandboxDelEnlace().includes("allow-modals");
    expect(lienzo, "una superficie enseña los diálogos y la otra se los traga").toBe(enlace);
  });

  // ── la línea que SÍ es de seguridad y no se toca ─────────────────────────

  it("🔴 y NO recupera `allow-same-origin` — ésa es la frontera de verdad", () => {
    // `allow-modals` no tiene nada que ver con lo que este sandbox protege. Lo
    // que protege es el ORIGEN OPACO: sin `allow-same-origin`, el JavaScript
    // del modelo corre pero no alcanza las cookies, el localStorage ni el DOM
    // de openlen.com. Ése fue el agujero de la auditoría del 2026-07-29 y el
    // motivo por el que este atributo existe. Ampliarlo para los diálogos no
    // puede colarse con lo otro de paquete.
    expect(sandboxDelLienzo().split(/\s+/)).not.toContain("allow-same-origin");
  });

  it("CONTRA-PRUEBA: las MINIATURAS siguen sin poder abrir diálogos", () => {
    // El lienzo es donde el usuario PRUEBA su página; una miniatura es una
    // estampa. Una lista de versiones donde cada estampa puede lanzarte un
    // alert al cargar es peor que el fallo que estamos arreglando.
    for (const ruta of [
      "components/workspace-v2/panels/versions-panel.tsx",
      "components/workspace-v2/panels/pages-panel.tsx",
      "components/workspace-v2/marketing-view.tsx",
      "components/workspace-v2/original-restore-modal.tsx",
    ]) {
      for (const [, valor] of fuente(ruta).matchAll(/sandbox="([^"]+)"/g)) {
        expect(valor.split(/\s+/), `${ruta}: una miniatura no abre diálogos`).not.toContain("allow-modals");
      }
    }
  });
});
