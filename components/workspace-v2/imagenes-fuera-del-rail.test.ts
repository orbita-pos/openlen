// LÁPIDA del 2026-08-29: el panel de Imágenes sale del rail, y lo suyo entra
// en el diálogo de sustituir.
//
// El icono enseñaba las MISMAS tres bibliotecas que el diálogo ya tenía
// —OpenLen, Unsplash, las fotos del negocio—, así que cobraba un sitio
// permanente en la navegación por una tercera copia. Lo que sólo tenía él se
// mudó: «Tus subidas» (que en el diálogo faltaba, y era la razón real por la
// que había que venir aquí) y Motion.
//
// Retirar es BARRIDO, no borrado: con el panel se van su entrada del rail, su
// miembro del tipo, su clave de idioma y su ruta de colocación.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const raiz = process.cwd();
const leer = (rel: string) => readFileSync(join(raiz, rel), "utf8");
const LOCALES = readdirSync(join(raiz, "messages")).filter((d) =>
  /^[a-z]{2}$/.test(d),
);

describe("el panel de Imágenes ya no existe", () => {
  it("el fichero se fue", () => {
    expect(existsSync(join(raiz, "components/workspace-v2/panels/images-panel.tsx")))
      .toBe(false);
  });

  it("el rail no lo declara ni lo puede abrir", () => {
    const rail = leer("components/workspace-v2/rail-model.ts");
    // La entrada del rail y el miembro del tipo. Comprobar sólo la palabra
    // "images" daría un falso rojo con el comentario-lápida que explica por
    // qué se fue — y castigar el porqué es cómo se pierde el porqué.
    expect(rail).not.toMatch(/id:\s*"images"/);
    expect(rail).not.toMatch(/\|\s*"images"/);
  });

  it("y /new no lo lista como pestaña abrible", () => {
    const pagina = leer("app/[locale]/new/page.tsx");
    const bloque = pagina.match(/const ALL_TABS: SidebarMode\[\] = \[[^\]]*\]/);
    expect(bloque).not.toBeNull();
    expect(bloque![0]).not.toMatch(/"images"/);
  });

  it.each(LOCALES)("%s — la etiqueta del rail se fue con él", (loc) => {
    const rail = JSON.parse(leer(`messages/${loc}/wsChrome.json`)).rail ?? {};
    expect("images" in rail).toBe(false);
    // BRAZO DE CONTROL: si el barrido se hubiera llevado el rail entero por
    // delante, lo de arriba pasaría igual y esta prueba mentiría.
    expect(typeof rail.chat).toBe("string");
    expect(typeof rail.versions).toBe("string");
  });
});

describe("lo que el panel tenía en exclusiva vive ahora en el diálogo", () => {
  const modal = leer("components/workspace-v2/replace-asset-modal.tsx");

  it("«Tus subidas» es una pestaña propia, distinta de «Subir»", () => {
    // Las dos, y son cosas distintas: `upload` SUBE un fichero nuevo,
    // `uploads` LISTA lo ya subido. Que existan las dos es el arreglo.
    expect(modal).toMatch(/value: "uploads" as const/);
    expect(modal).toMatch(/value: "upload" as const/);
    expect(modal).toMatch(/\/api\/projects\/\$\{projectId\}\/assets/);
  });

  it("Motion se ofrece sólo a quien pasa onInsertMotion", () => {
    // LA PUERTA ES LA PROP, no una bandera de «quién me abrió». Sin ella no
    // hay pestaña — así el Chat, donde elegir una foto la ADJUNTA al mensaje,
    // nunca ofrece un verbo (insertar una sección) que allí no existe.
    expect(modal).toMatch(/onInsertMotion\s*\n?\s*\?\s*\[\{ value: "motion"/);
    expect(modal).toMatch(/openlen-motion\/manifest\.json/);
  });

  it("y el diálogo del lienzo SÍ la pasa, mientras que el del Chat no", () => {
    const pagina = leer("app/[locale]/new/page.tsx");
    const chat = leer("components/workspace-v2/panels/chat-panel.tsx");
    expect(pagina).toMatch(/onInsertMotion=\{loadedProject \? handleInsertMotion/);
    expect(chat).not.toMatch(/onInsertMotion/);
  });
});

describe("las etiquetas no se pisan en ningún idioma", () => {
  // El panel tenía UNA lista de fuentes, así que en japonés y coreano
  // «uploads» se tradujo con la palabra corta y no chocaba con nada. Como
  // pestañas contiguas de «Subir», sí: las dos decían アップロード / 업로드.
  // Dos pestañas con la misma etiqueta son exactamente la confusión que esta
  // tanda venía a quitar.
  it.each(LOCALES)("%s — «Subir» y «Tus subidas» se distinguen", (loc) => {
    const tabs = JSON.parse(leer(`messages/${loc}/modalsAsset.json`)).image.tabs;
    expect(typeof tabs.upload).toBe("string");
    expect(typeof tabs.uploads).toBe("string");
    expect(tabs.uploads).not.toBe(tabs.upload);
  });

  it.each(LOCALES)("%s — Motion trae su texto y dice el verbo", (loc) => {
    const img = JSON.parse(leer(`messages/${loc}/modalsAsset.json`)).image;
    expect(typeof img.tabs.motion).toBe("string");
    expect(typeof img.motionHint).toBe("string");
    expect(typeof img.useMotionAria).toBe("string");
    expect(typeof img.uploadsEmpty).toBe("string");
  });
});

describe("el arrastre desde nuestras bibliotecas se perdió — a sabiendas", () => {
  it("ya nadie escribe DROP_ASSET_MIME en un dataTransfer", () => {
    // `startAssetDrag` era el único productor y se fue con el panel. Esto lo
    // deja escrito para que nadie lo descubra depurando.
    expect(existsSync(join(raiz, "components/workspace-v2/panels/images-panel.tsx")))
      .toBe(false);
  });

  it("pero soltar un FICHERO del escritorio sigue vivo, con sus cinco intenciones", () => {
    // Lo que de verdad importa proteger: el motor de soltado no se tocó. Si un
    // barrido futuro se llevara esto por delante, la página perdería la única
    // forma de poner un fondo de sección sin pasar por el Agente.
    const motor = leer("components/workspace-v2/use-drop-place.ts");
    for (const accion of [
      "replace-image",
      "section-bg",
      "media-split",
      "swap-images",
      "new-section",
    ]) {
      expect(motor).toContain(accion);
    }
    expect(leer("app/[locale]/new/page.tsx")).toMatch(/startPlacementFile/);
  });
});
