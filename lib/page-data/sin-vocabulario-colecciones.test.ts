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

  // ✅ CERRADO el 2026-08-29. `publish.bandModule.collections` era la última
  // palabra del módulo que quedaba en pie, y esperaba a que se retirara su
  // productor para no dejar el diálogo enseñando la ruta de una clave a un
  // usuario. Resultó que el productor ya no existía: `bandsWithModuleOff` se
  // declaraba y se leía en el PublishModal, pero NINGÚN llamador lo pasaba —
  // el aviso llevaba tiempo sin poder pintarse. Se fue con su vecino
  // `platformsBandWithoutLinks`, muerto por lo mismo.
  it.each(LOCALES)("%s — el diálogo de publicar tampoco la nombra", (loc) => {
    const dominio = JSON.parse(leer(`messages/${loc}/modalsDomain.json`));
    expect(dominio.publish ?? {}).not.toHaveProperty("bandModule");
    expect(dominio.publish ?? {}).not.toHaveProperty("bandsOffWarning");
    // BRAZO DE CONTROL: el diálogo conserva lo que SÍ usa. Sin esto, un
    // barrido que se llevara `publish` entero pasaría estas dos aserciones.
    expect(typeof dominio.publish?.languages?.hint).toBe("string");
  });
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

  // ✅ Y EL 2026-08-29 SE FUERON TAMBIÉN DE POSTGRES. Durante unos días
  // existieron sólo en la base: quitarlas del código es reversible, borrar 74
  // filas de producción no, así que esperaron a que Jesús lo decidiera.
  //
  // Se hizo con respaldo previo (JSON verificado por relectura, con la DDL
  // dentro) y con `scripts/collections-drop.ts`, NO con `db:push` — el push de
  // esquema completo es justo la herramienta que habría propuesto ese DROP por
  // su cuenta, en medio de otra tarea.
  //
  // Lo que esto vigila es que no quede en el repo un camino de vuelta: el
  // script que CREABA las tablas se borró en el mismo commit. Su DDL sigue
  // dentro del respaldo, que es donde sirve para restaurar.
  it("y ya no queda un script que las vuelva a crear", () => {
    expect(
      existsSync(join(process.cwd(), "scripts/collections-migrate.ts")),
    ).toBe(false);
    const pkg = JSON.parse(leer("package.json")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts).not.toHaveProperty("collections:migrate");
    // BRAZO DE CONTROL: el de borrar SÍ se queda. Es idempotente, y si un día
    // aparece una copia de la base con las tablas dentro, es lo que hay que
    // correr.
    expect(pkg.scripts).toHaveProperty("collections:drop");
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

  // ✅ CERRADO el 2026-08-29: `CollectionsSettings` y sus consumidores salieron
  // en la tanda siguiente. Lo vigila `sin-puente-ia-modulos.test.ts`, que es
  // donde vive el hecho más grande de aquello — el puente IA→módulos entero.
});
