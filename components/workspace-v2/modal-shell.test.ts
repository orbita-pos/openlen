// EL CAPARAZÓN DE UN DIÁLOGO SE USA, NO SE COPIA — Y CUÁNTOS FALTAN.
//
// Estaba escrito a mano en cada diálogo del taller: el velo, el panel, la
// cabecera, el aspa, la trampa de foco y el `Escape`. Copiado no es compartido, y
// se notó el 2026-08-27: arreglando el diálogo de imágenes («el bg blanco se me
// hace feísimo») el mismo arreglo hubo que aplicarlo a mano tres veces.
//
// Al extraer `ModalShell` y escribir esta prueba salió lo que no se veía: no
// eran tres, eran DOCE. Cada uno con su velo, su trampa y su forma de decidir si
// se puede cerrar mientras trabaja.
//
// Así que esto no prohíbe: CUENTA. Fija los que faltan por nombre, y exige que
// los ya migrados no vuelvan atrás. Mismo patrón que
// `guardar-sin-leer-el-lienzo.test.ts`, y por el mismo motivo: una deuda con un
// número delante se paga; una deuda escondida crece.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DIR = path.join(process.cwd(), "components", "workspace-v2");

/**
 * Los que TODAVÍA pintan su propio caparazón.
 *
 * Al migrar uno, se borra de aquí. Si la lista se queda vacía, la prueba de
 * abajo lo dice y este fichero pasa a ser lo que quería ser: una prohibición.
 */
const PENDIENTES: readonly string[] = [
  "custom-domain-modal.tsx",
  "deploy-integration-modal.tsx",
  // Vive DENTRO del diálogo de imágenes (pestaña «Editar»), así que su caso es
  // distinto: puede que no necesite caparazón propio, sino ninguno.
  "image-editor.tsx",
  "marketing-view.tsx",
  "original-restore-modal.tsx",
  "modules-panel.tsx",
  "site-pages-panel.tsx",
  "versions-panel.tsx",
  // Un desplegable, no un modal: lleva velo pero no trampa de foco. Habrá que
  // mirar si de verdad es un diálogo antes de migrarlo.
  "top-bar.tsx",
];

/** Los que YA usan `ModalShell`. No pueden volver a escribir el suyo. */
const MIGRADOS: readonly string[] = [
  "replace-asset-modal.tsx",
  "autofill-modal.tsx",
];

function fuente(fichero: string): string {
  return readFileSync(path.join(DIR, fichero), "utf8");
}

/** Los ficheros del taller que pintan un diálogo, buscados y no enumerados: uno
 *  nuevo tiene que aparecer solo, o el guardia sólo vigila lo que ya existía. */
function conDialogoPropio(): string[] {
  const salida: string[] = [];
  const mirar = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        mirar(p);
        continue;
      }
      if (!e.name.endsWith(".tsx")) continue;
      if (e.name === "modal-shell.tsx") continue;
      if (readFileSync(p, "utf8").includes('role="dialog"')) {
        salida.push(path.relative(DIR, p).replace(/\\/g, "/"));
      }
    }
  };
  mirar(DIR);
  return salida;
}

describe("cuántos diálogos escriben todavía su propio caparazón", () => {
  const encontrados = conDialogoPropio().map((f) => path.basename(f));

  it("los que faltan son EXACTAMENTE los apuntados — ni uno más", () => {
    expect(
      [...encontrados].sort(),
      "apareció un diálogo con caparazón propio que no está en la lista: úsalo con " +
        "ModalShell, o apúntalo aquí diciendo por qué no puede",
    ).toEqual([...PENDIENTES].sort());
  });

  it.each(MIGRADOS)("%s ya usa ModalShell y no vuelve atrás", (f) => {
    const src = fuente(f);
    expect(src, `${f} volvió a pintar su propio velo`).not.toMatch(
      /fixed inset-0[^"]*bg-black\//,
    );
    expect(src, `${f} volvió a montar su propia trampa de foco`).not.toContain("useFocusTrap");
    expect(src, `${f} volvió a poner un aspa de texto`).not.toContain("✕");
    expect(src, `${f} dejó de usar ModalShell`).toContain("ModalShell");
  });

  /** LA PUERTA. Cuando la lista se vacíe, esto lo dice — y entonces el `it.each`
   *  de arriba se puede sustituir por una prohibición sobre todo el directorio. */
  it("y mientras queden, siguen contados", () => {
    if (PENDIENTES.length === 0) {
      expect(encontrados, "ya no queda ninguno: convierte este contador en prohibición").toEqual([]);
    } else {
      expect(PENDIENTES.length).toBeGreaterThan(0);
    }
  });
});

describe("y el caparazón sostiene lo que le costó a la copia", () => {
  const shell = fuente("modal-shell.tsx");

  /**
   * 🔴 Y NO CON UNA UTILIDAD DE TAILWIND. `.workspace-v2` pinta su propio fondo,
   * el velo necesita esa clase para que sus hijos vean las variables, y las dos
   * tienen la MISMA especificidad — con `tokens.css` importado por la página, o
   * sea después de las utilidades, ganaba el fondo del taller.
   *
   * Los doce diálogos llevaban sin scrim desde siempre: el modal flotaba sobre
   * un plano uniforme. Se leía como «el bg blanco» y no lo era — era la página
   * entera pintada encima del velo. Lo destapó una captura de Jesús el
   * 2026-08-27, después de que yo arreglara dos veces el color equivocado.
   */
  it("el velo se pinta desde ol-scrim, que gana por especificidad", () => {
    expect(shell).toContain("ol-scrim");
    // Se mira el `className`, no el fichero: el comentario de arriba NOMBRA la
    // utilidad vieja para explicar por qué no sirve, y nombrarla no es usarla.
    const clase = /className="[^"]*"/g;
    for (const [m] of shell.matchAll(clase)) {
      expect(
        m,
        "el velo volvió a una utilidad de fondo: `.workspace-v2` la pisa y no se ve",
      ).not.toMatch(/bg-black\//);
    }

    const tokens = readFileSync(
      path.join(process.cwd(), "app", "[locale]", "new", "tokens.css"),
      "utf8",
    );
    // DOS clases, no una: es lo único que la hace ganar.
    expect(tokens, "la regla del velo no existe o perdió su segunda clase").toContain(
      ".workspace-v2.ol-scrim",
    );
    expect(tokens).toContain("backdrop-filter");
  });

  /** Cabecera y cuerpo eran el mismo blanco con una raya en medio. El tono
   *  recesivo ya existía en la paleta; sólo no se usaba. */
  it("la cabecera va en el tono recesivo que la paleta ya tenía", () => {
    expect(shell).toContain("bg-side");
  });

  /**
   * UNA SOLA PALANCA PARA LAS TRES SALIDAS. Antes cada diálogo se acordaba por
   * su cuenta de bloquear el aspa, el velo y `Escape` mientras trabajaba, y
   * bastaba olvidar una para que el usuario abortara a media escritura.
   */
  it("`dismissable` apaga el aspa, el velo y Escape a la vez", () => {
    expect(shell).toContain("if (!open || !dismissable) return;");
    expect(shell).toContain("if (dismissable) onClose();");
    expect(shell).toContain("disabled={!dismissable}");
  });

  /** `fixed` no se resuelve contra la ventana sino contra el ancestro
   *  transformado más cercano: montado dentro de la barra lateral, el diálogo
   *  quedaba encajado en ella. Sólo UNO de los tres portaba; los otros dos
   *  tenían el mismo fallo latente y no había salido todavía. */
  it("y siempre va al <body>", () => {
    expect(shell).toContain("createPortal(");
    expect(shell).toContain("document.body");
  });
});
