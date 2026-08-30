// LÁPIDA FINAL: no queda vocabulario de colecciones en lo que el usuario ve ni
// en lo que se le cobra.
//
// Retirar es BARRIDO, no borrado. Con el mecanismo se van sus claves de idioma,
// sus tipos y lo que los prompts ofrecían — y esto último es lo que sale caro:
// un prompt que sigue ofreciendo lo retirado hace que el modelo lo intente,
// falle, y el turno se cobre igual. Ya pasó con Pedidos y con Reservas.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = readdirSync(join(process.cwd(), "messages")).filter((d) =>
  /^[a-z]{2}$/.test(d),
);

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("no queda vocabulario de colecciones", () => {
  // ✅ CERRADO el 2026-08-29. Lo que desbloqueó el barrido de idiomas no fue
  // sacar `CollectionsSettings` —sigue en `lib/projects/types.ts`— sino borrar
  // `collections-panel.tsx`: era el ÚNICO consumidor del namespace, y el tipo
  // vive en `lib/` sin tocar una sola clave de traducción. La dependencia que
  // yo había supuesto entre las dos cosas no existía.
  it.each(LOCALES)("%s — el fichero del módulo ya no está", (loc) => {
    expect(readdirSync(join(process.cwd(), "messages", loc))).not.toContain(
      "collections.json",
    );
  });

  it("y el cargador de i18n ya no lo pide", () => {
    // Si el fichero se borra pero el import se queda, la app no arranca: es un
    // import estático. Los dos hechos van juntos o no valen.
    expect(leer("i18n/request.ts")).not.toMatch(/collections/i);
  });

  it.each(LOCALES)("%s — las claves sueltas del módulo tampoco", (loc) => {
    const chrome = JSON.parse(leer(`messages/${loc}/wsChrome.json`));
    const page = JSON.parse(leer(`messages/${loc}/wsPage.json`));
    expect(chrome.sidebar?.tabs ?? {}).not.toHaveProperty("collections");
    expect(page.toast ?? {}).not.toHaveProperty("moduleCollections");
  });

  // LA TRAMPA, ahora como prueba en vez de como aviso. «New collection» es un
  // EJEMPLO DE OFERTA en el marketing, y «seasonal collections» describe la
  // familia de moda: prosa legítima que un barrido por la palabra suelta
  // habría mutilado para ponerse verde. Este brazo de control falla si alguien
  // “termina” el barrido llevándose textos correctos por delante.
  it.each(LOCALES)("%s — pero la prosa legítima sigue intacta", (loc) => {
    const page = JSON.parse(leer(`messages/${loc}/wsPage.json`));
    expect(typeof page.marketing?.offerPlaceholder).toBe("string");
  });

  // 🔴 LO QUE SIGUE VIVO Y NO ES UN OLVIDO: `modalsDomain` conserva
  // `publish.bandModule.collections`, porque `components/workspace/
  // publish-modal.tsx` —que SÍ se monta— todavía la pinta. Su productor de
  // `bandsWithModuleOff` es lo que hay que retirar primero; borrar la clave
  // antes dejaría el diálogo enseñando la ruta de la clave a un usuario.
  // Los prompts son lo que más caro sale. Se comprueban por separado para que
  // el fallo diga CUÁL, no «alguno».
  // `lib/agent/catalog.ts` NO entra en esta lista: sus menciones que quedan son
  // COMENTARIOS-LÁPIDA que explican qué murió y por qué. Lo que de verdad se le
  // manda al modelo lo fija `catalog.test.ts` sobre `buildAgentSystemPrompt()`,
  // que es la cadena real. Comprobar el fichero castigaría escribir el porqué.
  it.each([
    "lib/design-guidance.ts",
    "app/api/templates/ai-design/system-prompt.ts",
  ])("%s no la ofrece", (rel) => {
    expect(leer(rel)).not.toMatch(/collections/i);
  });
});

describe("ni en el esquema", () => {
  it("las tablas salen de lib/db/schema.ts", () => {
    const esquema = leer("lib/db/schema.ts");
    expect(esquema).not.toMatch(/export const collections\b/);
    expect(esquema).not.toMatch(/export const collectionItems\b/);
  });

  it("y el panel del taller que las gestionaba tampoco", () => {
    // No sólo estaba sin montar: las rutas a las que llamaba
    // (/api/projects/[id]/collections/*) ya no existían, así que cada acción
    // suya habría dado 404. 770 líneas describiendo un servidor ausente.
    expect(
      existsSync(
        join(process.cwd(), "components/workspace-v2/panels/collections-panel.tsx"),
      ),
    ).toBe(false);
  });

  // 🔴 PENDIENTE: `CollectionsSettings` sigue en `lib/projects/types.ts`. Tiene
  // cinco consumidores en lib/ (module-intent, settings-patch, tools.ts) y
  // sacarlo es la siguiente tanda. Cuando salga:
  //
  //   expect(leer("lib/projects/types.ts")).not.toMatch(/collections\?:/);
});
