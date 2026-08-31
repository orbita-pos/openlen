// EL PERFIL DE NEGOCIO YA NO TOCA LA PÁGINA — la inversa, en una prueba.
//
// Aquí vivían, repartidas por `lib/business-profiles/seed-html.test.ts`, diez
// pruebas que fijaban que el sembrado PUSIERA un botón flotante de contacto con
// el WhatsApp del dueño. Esta es su inversa, y el motivo es el que las mató:
//
//   no se podía quitar.
//
// `seedBrandIntoHtml` corría en CADA guardado, así que el usuario pedía
// «quítamelo», el Agente lo borraba con `editar_pagina`, decía «listo», y el
// widget volvía al siguiente guardado. Pasó dos veces seguidas con el mismo
// usuario. Un control que reaparece solo no es un control: es la página
// contradiciendo a su dueño.
//
// Hoy, si alguien quiere un botón flotante, el modelo se lo escribe DENTRO del
// documento — y entonces es suyo: se mueve, se recolorea y se BORRA como
// cualquier otra cosa.
//
// POR QUÉ ES UNA PRUEBA DE FUENTES y no de comportamiento: lo que hay que
// vigilar es que la capacidad no VUELVA por otra puerta. Un fichero que se
// vuelve a escribir es exactamente cómo volvería.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { sinComentarios } from "@/lib/sin-comentarios";

const raiz = process.cwd();

// La fuente SIN COMENTARIOS. Sin esto el guardia no sirve, y se descubrió al
// escribirlo: las tres aserciones de abajo fallaron contra las LÁPIDAS que este
// mismo barrido dejó («⚰️ Aquí corría `seedBrandIntoHtml`…»). Una prueba que no
// distingue una LLAMADA de una MENCIÓN obliga a elegir entre el guardia y la
// explicación — y en este repo la explicación de por qué algo se retiró es lo
// que impide que vuelva.
//
// Es el reverso exacto de «el código muerto sigue hablando»: allí un comentario
// viejo mintió sobre lo que el código hacía; aquí uno correcto tumbaba una
// comprobación sana.
//
// La copia local se mudó a `lib/sin-comentarios.ts` el 2026-08-31: estaba en
// tres sitios a la vez y las tres tenían el mismo fallo de orden. El
// razonamiento largo vive allí.
const leer = (rel: string) => sinComentarios(readFileSync(join(raiz, rel), "utf8"));
describe("el sembrado de marca ya no existe", () => {
  // 🔴 INVERTIDA en el paso 5 (2026-08-31). Decía «`lib/business-profiles/`
  // sólo conserva sus tipos», y explicaba por qué: la tabla seguía en la base y
  // `schema.ts` tipaba su columna con ella. Jesús aprobó tirarla ese mismo día,
  // así que `types.ts` se quedó sin su último motivo para existir y el
  // directorio entero se fue.
  it("`lib/business-profiles/` ya no existe", () => {
    expect(existsSync(join(raiz, "lib/business-profiles"))).toBe(false);
  });

  it("y la tabla salió del esquema con su columna", () => {
    const esquema = leer("lib/db/schema.ts");
    // Sin comentarios: las lápidas que la NOMBRAN no son la tabla.
    expect(esquema).not.toMatch(/pgTable\(\s*\n?\s*"businessProfiles"/);
    expect(esquema).not.toMatch(/profileId:/);
    // Y el script que la CREABA se retiró con ella: dejarlo es dejar un botón
    // que la resucita, y el próximo que lo corra no sabrá que no debía.
    expect(existsSync(join(raiz, "scripts/businessProfiles-migrate.ts"))).toBe(false);
  });

  // 🔴 ESTA PRUEBA SE INVIRTIÓ AL ARMAR EL BORRADO — el mismo día, a propósito.
  //
  // Decía «existe pero NO está armada todavía», y era la guarda de la ventana:
  // `deploy.ps1` aplica migraciones en el paso 6 y cambia el código en el 7,
  // con la reconstrucción de los crates (~5 min) en medio. Soltar la columna
  // mientras producción sirve el código que la SELECCIONA son cinco minutos de
  // 500 en cada listado de proyectos. Por eso fueron dos despliegues.
  //
  // El primero salió el 2026-08-31 y se COMPROBÓ en la caja, no por calendario:
  // ni `profileId` ni `businessProfiles` aparecen ya en `/opt/openlen-app/.next/`.
  // Con eso, armarlo dejó de tener ventana.
  //
  // Lo que clava ahora: que la migración siga listada. Si alguien la saca de
  // `targets` creyendo que ya corrió, la columna sobrevive en cualquier base
  // que no la haya recibido — y es idempotente, así que listarla no cuesta nada.
  it("la migración de borrado existe y está armada", () => {
    expect(existsSync(join(raiz, "scripts/perfil-drop-migrate.ts"))).toBe(true);
    const bundle = leer("scripts/build-migrations.mjs");
    expect(bundle).toMatch(/"perfil-drop-migrate"/);
  });

  it("`seedBrandIntoHtml` no lo importa nadie", () => {
    expect(existsSync(join(raiz, "lib/business-profiles/seed-html.ts"))).toBe(false);
    // El motor de página era su único llamador vivo, y desde el 2026-08-30 la
    // línea estaba en `const seeded = h;` — dejarla habría sido código muerto
    // hablando.
    expect(leer("lib/page-engine/prepare.ts")).not.toMatch(/seedBrandIntoHtml/);
  });

  // BRAZO DE CONTROL: que estas tres cadenas EXISTAN en algún sitio del repo
  // sería la señal de que el widget volvió. Que no existan en ninguna de las
  // tuberías que escriben HTML es lo que se fija.
  it("ninguna tubería que escribe HTML inyecta un botón flotante", () => {
    const tuberias = [
      "lib/page-engine/prepare.ts",
      "lib/publish/filesystem.ts",
      "lib/publish/preview-bake.ts",
      "app/api/generate/route.ts",
      "app/api/projects/from-html/route.ts",
      "app/api/projects/from-template/route.ts",
      "app/api/templates/ai-design/route.ts",
      "app/api/agent/route.ts",
    ];
    for (const t of tuberias) {
      const fuente = leer(t);
      expect(fuente, t).not.toMatch(/data-ol-contact-widget/);
      expect(fuente, t).not.toMatch(/injectContactWidget/);
    }
  });

  // `llms-txt.ts` es la EXCEPCIÓN legítima y va nombrada para que nadie la
  // "limpie" por parecerse: no lo pone, lo EXCLUYE — de las páginas viejas que
  // ya lo tienen horneado dentro de su HTML.
  it("llms-txt sigue excluyéndolo de las páginas viejas", () => {
    expect(leer("lib/publish/llms-txt.ts")).toMatch(/data-ol-contact-widget/);
  });
});

describe("el Agente ya no lee ni escribe el perfil", () => {
  it("no le quedan herramientas de negocio", () => {
    const catalogo = leer("lib/agent/catalog.ts");
    expect(catalogo).not.toMatch(/guardar_dato_del_negocio/);
    expect(catalogo).not.toMatch(/recordar_del_negocio/);
    // BRAZO DE CONTROL: la memoria de USUARIO sobrevive, y con ella la única
    // continuidad que el dueño del repo sí quiso. Sin esta línea, un barrido
    // que se llevara las tres pasaría igual.
    expect(catalogo).toMatch(/recordar_preferencia/);
  });

  it("el ESTADO ya no lleva un bloque `negocio`", () => {
    expect(leer("lib/agent/tools.ts")).not.toMatch(/summarizeBusinessForAgent/);
    expect(existsSync(join(raiz, "lib/agent/business.ts"))).toBe(false);
  });

  it("el rediseño no recibe hechos del perfil — los COMPRUEBA en el resultado", () => {
    expect(leer("lib/agent/redesign.ts")).not.toMatch(/DATOS REALES DEL NEGOCIO/);
    // Y esto es lo que ocupa su lugar: no una frase en el prompt, una medición.
    expect(leer("lib/agent/tools.ts")).toMatch(/hechosPerdidos/);
  });
});
