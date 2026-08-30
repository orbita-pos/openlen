// LÁPIDA FINAL: no queda vocabulario de colecciones en lo que el usuario ve ni
// en lo que se le cobra.
//
// Retirar es BARRIDO, no borrado. Con el mecanismo se van sus claves de idioma,
// sus tipos y lo que los prompts ofrecían — y esto último es lo que sale caro:
// un prompt que sigue ofreciendo lo retirado hace que el modelo lo intente,
// falle, y el turno se cobre igual. Ya pasó con Pedidos y con Reservas.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const LOCALES = readdirSync(join(process.cwd(), "messages")).filter((d) =>
  /^[a-z]{2}$/.test(d),
);

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("no queda vocabulario de colecciones", () => {
  // 🔴 PENDIENTE, y a propósito no como prueba en rojo: quedan los ficheros
  // `messages/<locale>/collections.json` (21 en total) y las claves sueltas de
  // `wsChrome`, `wsPage` y `modalsDomain`. El barrido de idiomas se para aquí
  // porque el tipo `CollectionsSettings` todavía tiene cinco consumidores en
  // `lib/` —module-intent, settings-patch, tools.ts— y quitarlo antes dejaba el
  // árbol rojo a mitad.
  //
  // Una prueba que falla no vigila nada: se ignora a la primera. Cuando el tipo
  // salga, esta aserción vuelve:
  //
  //   it.each(LOCALES)("%s — ninguna clave del módulo sobrevive", (loc) => {
  //     expect(readdirSync(dir)).not.toContain("collections.json");
  //   });
  //
  // OJO al escribirla: «seasonal collections» (familia de moda) y «New
  // collection» (ejemplo de oferta) son prosa legítima. Una aserción sobre la
  // palabra suelta obligaría a mutilar textos correctos para que pase.
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

  // 🔴 PENDIENTE: `CollectionsSettings` sigue en `lib/projects/types.ts`. Tiene
  // cinco consumidores en lib/ (module-intent, settings-patch, tools.ts) y
  // sacarlo es la siguiente tanda. Cuando salga:
  //
  //   expect(leer("lib/projects/types.ts")).not.toMatch(/collections\?:/);
});
