import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as catalogo from "./catalog";
import {
  AGENT_MODULES,
  buildAgentSystemPrompt,
  buildFunctionDeclarations,
  instruccionesDeLen,
} from "./catalog";
import { clauseMarker } from "@/lib/ai/js-clause";
import { BEHAVIOR_ORDER, BEHAVIORS } from "@/lib/conductas-heredadas/registry";
import { PUBLISH_LOCALES } from "@/lib/publish/publish-locales";

const SALTO = String.fromCharCode(10);


/** Lo que Len 2.0 ya NO le ofrece al modelo (plans/len-2/ficheros-plan.md):
 *  el vocabulario propio por ids, la mudanza de página, el rediseño con un
 *  segundo modelo y los atajos de tema. Un nombre de aquí que reaparezca en una
 *  descripción o en el prompt es una herramienta que el modelo intentará
 *  llamar y no existe. */
const RETIRADAS = [
  // H3 (2026-09-25): los almacenes y la memoria son ficheros.
  "leer_estado",
  "guardar_dato",
  "editar_dato",
  "quitar_dato",
  "recordar_preferencia",
  "editar_texto",
  "editar_atributos",
  "editar_html",
  "editar_runtime",
  "editar_pagina",
  "trabajar_en_pagina",
  "buscar_en_pagina",
  "crear_pagina",
  "redisenar_pagina",
  "cambiar_tema",
  "aplicar_tematica",
  // Len 2.1 (2026-09-30): 0 llamadas en la historia de producción.
  "preparar_marketing",
  // Len 2.1 (2026-09-30): «datos vivos» se retiró entero, y sin diferidas
  // ToolSearch no tenía nada que cargar.
  "conectar_datos_vivos",
  "ToolSearch",
] as const;

describe("buildFunctionDeclarations", () => {
  it("declara exactamente las de Len 2.0: las cinco de ficheros primero", () => {
    const names = buildFunctionDeclarations().map((d) => d.name);
    expect(names).toEqual([
      // El sitio como ficheros, con el contrato de Claude Code.
      "Read",
      "Edit",
      "Write",
      "Grep",
      "Glob",
      "activar_modulo",
      "mirar_pagina",
      // H9: usarla, no sólo mirarla. Cargada desde el principio.
      "usar_pagina",
      "elegir_foto",
      "editar_imagen",
      "publicar",
      "web_search",
      "web_fetch",
      "TodoWrite",
      "preguntar",
      "revertir_ultimo_cambio",
      // Len sabe de tus resultados (plans/len-resultados/): una por fuente,
      // siempre cargadas, como los conectores de Grok, dots y Claude.
      "ver_visitas",
      "ver_formularios",
      "ver_mensajes",
      // Y el borrador: no manda nada, deja una tarjeta con su botón.
      "preparar_respuesta",
    ]);
  });

  // LA LÁPIDA DE H2 (Len 2.1, 2026-09-30). Las diferidas y ToolSearch se
  // retiraron: ToolSearch se llamó 2 veces en 958 turnos grabados y 1 en toda
  // producción, y las dos últimas diferidas se fueron ese día. Sin diferidas,
  // una herramienta para cargarlas sería una palanca a ninguna parte.
  it("sin diferidas ni ToolSearch: todo va cargado", () => {
    expect("HERRAMIENTAS_DIFERIDAS" in catalogo).toBe(false);
    expect(buildFunctionDeclarations().some((d) => d.name === "ToolSearch")).toBe(false);
    expect(buildAgentSystemPrompt()).not.toContain("ToolSearch");
  });

  it("🔴 ninguna descripción nombra una herramienta retirada, ni data-op-id, ni prueba_js", () => {
    for (const d of buildFunctionDeclarations()) {
      const texto = JSON.stringify(d);
      for (const vieja of [...RETIRADAS, "data-op-id", "op_id", "prueba_js", "incluir_documento", "ver_pagina"]) {
        expect(texto, `${d.name} nombra ${vieja}`).not.toContain(vieja);
      }
    }
  });

  it("mirar_pagina y revertir_ultimo_cambio dicen A QUÉ FICHERO, sin página activa", () => {
    for (const nombre of ["mirar_pagina", "revertir_ultimo_cambio"]) {
      const d = buildFunctionDeclarations().find((x) => x.name === nombre) as any;
      expect(d.parameters.properties.file_path?.type, nombre).toBe("STRING");
      expect(d.parameters.required ?? [], nombre).not.toContain("file_path");
    }
  });

  // 🔴 El esquema NO puede anunciar un módulo retirado: Reservas se retiró el
  // 2026-08-21 y el enum escrito a mano siguió ofreciéndolo.
  it("activar_modulo enum matches AGENT_MODULES", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "activar_modulo") as any;
    expect(d.parameters.properties.modulo.enum).toEqual([...AGENT_MODULES]);
    expect(d.parameters.required).toContain("modulo");
  });
  // 🔴 REAPUNTADA el 2026-09-05, no retirada. Exigía el literal `/api/f/`, que
  // vivía en la línea de REGLAS DURAS. Esa línea se recortó a su mitad de
  // CONDUCTA —ofrecer el formulario, el ejemplo con la herramienta, los módulos
  // ADEMÁS— porque la MECÁNICA la dice ahora el contrato, y la dice mejor: trae
  // el modo de fallo. La ruta literal no la necesita el modelo (se le prohíbe
  // escribir el `action`), así que fijarla era fijar una redacción, no la verdad.
  //
  // La verdad son TRES cosas, y las tres se comprueban aquí: que funcionan, que
  // no se les escribe `action`/`method`/JavaScript, y qué pasa si igualmente se
  // les cuelga un `onsubmit`. La tercera es la que se midió el 2026-09-05:
  // 4 de 12 páginas entregaban un formulario que cancelaba su propio envío.
  it("el prompt dice la VERDAD sobre los formularios", () => {
    const p = instruccionesDeLen();
    // La conducta, en LO QUE HAY Y LO QUE NO: ofrécelo, no lo desaconsejes.
    // Dicho en llano desde la auditoría del 2026-09-29: el «SÍ» contestaba a
    // una regla vieja que el modelo nunca vio.
    expect(p).toContain("Los formularios funcionan");
    expect(p).toContain("ofrece el formulario; el WhatsApp o el chat, además, no en su lugar");
    // La mecánica, en el contrato: el destino lo pone el publicador.
    expect(p).toMatch(/hornea al `<form>` su `action`/);
    expect(p).toMatch(/NO le pongas `action`/);
    // Y el modo de fallo, que es lo que de verdad rompía la página.
    expect(p).toMatch(/CANCELA el envío de verdad/);
  });
  // RETIRADAS el 2026-08-26 con motion, música y 3D: las tres herramientas de
  // settings salieron del catálogo. Eran presets nuestros que suplían el
  // JavaScript prohibido —una coreografía de scroll, un reproductor flotante y
  // una escena WebGL— y el modelo ahora escribe la animación, el reproductor y
  // el canvas dentro del documento, pudiendo hacer EL que la página pide.
  // LA LÁPIDA de `preparar_marketing` (Len 2.1, 2026-09-30): 0 llamadas en la
  // historia de producción, y la pestaña Marketing elige el rubro sola. Esta
  // prueba sujetaba su esquema; ahora sujeta que no vuelva.
  it("preparar_marketing ya no está en el catálogo", () => {
    expect(buildFunctionDeclarations().some((x) => x.name === "preparar_marketing")).toBe(false);
  });
  it("elegir_foto exposes busqueda + estilo as optional strings, nothing required", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "elegir_foto") as any;
    expect(d.parameters.properties.busqueda.type).toBe("STRING");
    expect(d.parameters.properties.estilo.type).toBe("STRING");
    // estilo is a free string (typos just yield zero matches, not an error) —
    // no enum constraint, so the model can't get stuck on an out-of-date list.
    expect(d.parameters.properties.estilo.enum).toBeUndefined();
    expect(d.parameters.required).toBeUndefined();
  });
  it("editar_imagen requires imagen_url + instruccion as strings", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "editar_imagen") as any;
    expect(d.parameters.properties.imagen_url.type).toBe("STRING");
    expect(d.parameters.properties.instruccion.type).toBe("STRING");
    expect(d.parameters.required).toEqual(["imagen_url", "instruccion"]);
    // The description must steer the model away from external URLs and toward
    // elegir_foto for brand-new photos.
    expect(String(d.description)).toContain("elegir_foto");
  });
  /**
   * EL ENUM SALE DE LA FUENTE. Escrito a mano se quedaría atrás el día que se
   * añada un campo —igual que le pasó al enum de módulos con Reservas— y el
   * modelo leería como válido un campo que el aplicador rechaza.
   */
  // ⚰️ Aquí se comprobaba que `guardar_dato_del_negocio` ofreciera exactamente
  // los campos del perfil. La herramienta se retiró el 2026-08-31 con el perfil
  // de negocio: los datos del dueño viven en su página, no en otra tabla.
  it("🔴 ya NO declara herramientas que escriban en el perfil de negocio", () => {
    const nombres = buildFunctionDeclarations(process.env).map((t) => t.name);
    expect(nombres).not.toContain("guardar_dato_del_negocio");
    expect(nombres).not.toContain("recordar_del_negocio");
    // BRAZO DE CONTROL: la memoria de la PERSONA NO es su hermana y se queda —
    // users.agentMemory no está escrita en ninguna página—; desde H3 es el
    // fichero /memoria/dueno.md.
    expect(buildAgentSystemPrompt()).toContain("/memoria/dueno.md");
  });

  it("H3 · la memoria son dos ficheros: sólo lo DURABLE, nunca el pedido puntual, y sólo se añade", () => {
    const p = buildAgentSystemPrompt();
    const seccion = p.slice(p.indexOf("LA MEMORIA SON DOS FICHEROS")).split(SALTO + SALTO)[0];
    expect(seccion).toContain("/memoria/dueno.md");
    expect(seccion).toContain("/memoria/proyecto.md");
    expect(seccion).toContain("DURABLE");
    expect(seccion.toLowerCase()).toContain("puntual");
    expect(seccion).toContain("Sólo se añade");
  });
  it("publicar exposes optional subdominio + idiomas(ARRAY of STRING), nothing required, enumerates PUBLISH_LOCALES", () => {
    const d = buildFunctionDeclarations().find((x) => x.name === "publicar") as any;
    expect(d.parameters.type).toBe("OBJECT");
    expect(d.parameters.properties.subdominio.type).toBe("STRING");
    expect(d.parameters.properties.idiomas.type).toBe("ARRAY");
    expect(d.parameters.properties.idiomas.items.type).toBe("STRING");
    // Both optional — the tool asks the user for a subdomain when there's no
    // claim, rather than failing schema validation.
    expect(d.parameters.required).toBeUndefined();
    // The valid idiomas codes are enumerated in the description, generated from
    // the PUBLISH_LOCALES import (never hardcoded).
    for (const l of PUBLISH_LOCALES) expect(String(d.description)).toContain(l.code);
    // The user-tap gate must be conveyed to the model.
    expect(String(d.description).toLowerCase()).toContain("usuario");
  });
  // LA LÁPIDA de «datos vivos» (Len 2.1, 2026-09-30): 0 llamadas en la historia
  // de producción y 0 de 118 proyectos con una hoja conectada. Se retiró la
  // función entera, y ésta era su única puerta.
  it("conectar_datos_vivos ya no está en el catálogo", () => {
    expect(buildFunctionDeclarations().some((x) => x.name === "conectar_datos_vivos")).toBe(false);
  });
});

describe("buildAgentSystemPrompt", () => {
  // INVERTIDO el 2026-08-25. Esta prueba decía «ON/subpágina no anuncia
  // runtime» y era cierta, pero describía una limitación de almacenamiento —una
  // sola columna para la cápsula— vendida como regla de producto. Ahora cada
  // página guarda la suya, así que con el interruptor encendido el prompt es el
  // MISMO en todas: el Agente no tiene por qué saber en qué documento está para
  // saber si puede escribir JavaScript.
  it("el prompt le ofrece escribir JavaScript, esté en la página que esté", () => {
    const p = instruccionesDeLen();
    expect(p).toContain("<script>");
    expect(p).not.toContain("OpenLen NO ejecuta JavaScript de la página");
  });

  // EL PROMPT NO PUEDE OFRECER LO QUE NO EXISTE. Hasta el 2026-08-27 abría con
  // «los módulos (reservas, cuentas, chat, catálogo…) son features REALES ya
  // construidas» y quince líneas más abajo, en el mismo prompt, decía que
  // Reservas y Cuentas SE RETIRARON. Las dos frases viajaban juntas al modelo y
  // la primera es la que suena a promesa: el usuario pide reservas, el Agente
  // ya leyó que son una feature real. Desde la auditoría del 2026-09-29 la
  // apertura no nombra ningún módulo: los que existen van en su bloque, que se
  // deriva de `AGENT_MODULES` (ver «cada módulo que el prompt enumera…»).
  it("la frase de apertura no ofrece ningún módulo retirado", () => {
    const p = buildAgentSystemPrompt();
    // Hasta el primer encabezado (TONO:). Medía hasta «REGLAS DURAS», que H4
    // (2026-09-26) renombró a «CÓMO TRABAJAR»; sin el ancla, la «apertura» era
    // el prompt entero.
    expect(p.indexOf("TONO:")).toBeGreaterThan(0);
    const abre = p.slice(0, p.indexOf("TONO:")).toLowerCase();
    expect(abre).toContain("eres len");
    for (const retirado of ["reservas", "cuentas", "pedidos", "comentarios", "broadcast", "miembros"]) {
      expect(abre, `la apertura sigue ofreciendo ${retirado}, que se retiró`).not.toContain(retirado);
    }
  });

  /** El bloque del prompt que abre con `titulo`, hasta el renglón en blanco. */
  const bloqueDe = (prompt: string, titulo: string): string =>
    prompt.slice(prompt.indexOf(titulo)).split(SALTO + SALTO)[0];

  // NINGUNA FICHA SIN FUNCIÓN DETRÁS. `cambiar_motion` se retiró el 2026-08-26
  // y su ficha se quedó en HERRAMIENTAS DE SETTINGS, con instrucciones de uso:
  // el modelo leía «usa look="off" para apagarla» sobre una función que ya no
  // se declaraba. Es el mismo fallo silencioso del enum de módulos, un párrafo
  // más arriba del prompt.
  it("cada herramienta que el prompt describe está DECLARADA", () => {
    const p = buildAgentSystemPrompt();
    const declaradas = new Set(buildFunctionDeclarations().map((d) => String(d.name)));
    // Desde H4 (2026-09-26) el único bloque que describía herramientas era el
    // de las diferidas, y se fue con ellas en Len 2.1: el prompt ya no describe
    // ninguna. Lo que queda por vigilar es que no vuelva un bloque así con
    // fichas de herramientas que no existen.
    expect(p).not.toContain("HERRAMIENTAS QUE SE CARGAN CUANDO HACEN FALTA");
    for (const m of p.matchAll(/^- ([a-z]+_[a-z_]+):/gm)) {
      expect(declaradas, `el prompt describe ${m[1]}, que no se declara`).toContain(m[1]);
    }
  });

  // Y su gemela para los módulos: la lista que el prompt enumera es la misma
  // que el enum de `activar_modulo`, no una copia que se queda atrás.
  it("cada módulo que el prompt enumera está en AGENT_MODULES", () => {
    const p = buildAgentSystemPrompt();
    const bloque = bloqueDe(p, "MÓDULOS QUE PUEDES OPERAR");
    const listados = [...bloque.matchAll(/^- ([a-z_]+):/gm)].map((m) => m[1]);
    expect(listados).toEqual([...AGENT_MODULES]);
  });

  it("voltea agente + contrato completo + CONDUCTAS sin anexar otro contrato", () => {
    const p = instruccionesDeLen();

    for (const id of ["agente", "contrato-completo", "conductas"] as const) {
      expect(p).not.toContain(clauseMarker(id));
    }
    for (const mentira of [
      "NEVER your own JavaScript",
      "the script is deleted",
      "NUNCA tu propio JavaScript",
      "NUNCA tu propio JavaScript, ni una línea",
      // LAS CINCO DEL 2026-08-27. La cláusula del JavaScript ya se volteaba
      // —el prompt SÍ decía «Puedes escribir el JavaScript de la página»— pero
      // cinco reglas duras sobrevivían al cambio y decían lo contrario. Jesús
      // pidió un carrito y le contestó «un carrito de compras NO EXISTE en
      // OpenLen»: es la línea de abajo recitada casi palabra por palabra.
      //
      // Las reglas duras ganan a una cláusula suelta. Un prompt que se
      // contradice no es un prompt a medio arreglar: es el prohibitivo.
      "fuera de tu catálogo",
      "blog dinámico, buscador interno",
      "no la construyas como maqueta estática",
      "NUNCA fabriques en HTML lo que ya existe como módulo",
      "eso NO se resuelve con un script",
      // Y las CONDUCTAS, retiradas el 2026-08-23 con sus recetas.
      "una CONDUCTA quedó mal cableada",
    ]) {
      expect(p, `quedó la prohibición obsoleta: ${mentira}`).not.toContain(mentira);
    }
    for (const name of BEHAVIOR_ORDER) {
      expect(p, `quedó el marcador declarativo de ${name}`).not.toContain(BEHAVIORS[name].marker);
    }
    expect(p).not.toContain("data-ol-sticky");
    expect(p).toContain("<script>");
    // Sin «usa `addEventListener`, no `onclick`» desde el 2026-09-29: el
    // editor ya no borra los `on*` (lib/publish/el-on-del-modelo.test.ts), así
    // que la regla protegía a la plataforma, no al modelo.
    expect(p).not.toContain("addEventListener");
    expect(p).not.toContain("onclick=");
    // POR SUSTANCIA, NO POR ENCABEZADO — ver el mismo cambio en context.test.ts.
    // «LAS DOS MITADES» ya no va en el prompt desde el 2026-09-29: la hace
    // cumplir el diagnóstico `clase-sin-estilo` (prompts-superficies.test.ts).
    expect(p).not.toContain("LAS DOS MITADES");
    // Sin «La página tiene que funcionar SIN él» ni «prefiere el CSS puro»
    // desde el 2026-09-29: nacieron cuando la plataforma tiraba el script, y
    // ya no lo tira. «No escondas contenido» se queda, con el porqué que es
    // verdad hoy: que el script del propio modelo falle.
    expect(p).not.toContain("funcionar SIN él");
    expect(p).not.toContain("CSS puro");
    expect(p).toContain("si el script falla, la página llega en blanco");
    expect(p).not.toContain("si el script se descarta");
    // LA FRONTERA ES EL SERVIDOR, NO EL CATÁLOGO. Es la frase que sustituye a
    // las cinco de arriba, y la que decide si el Agente construye un carrito o
    // se niega. Lo que NO se puede sigue dicho, y es poco y concreto. En llano
    // desde el 2026-09-29, sin el «NO ES» que contestaba a la regla vieja.
    expect(p).toContain("no lo limita tu lista de herramientas, sino si necesita un servidor");
    expect(p).toContain("LO QUE DE VERDAD NO SE PUEDE");
    expect(p).toContain("no hay pasarela");
    // EL CARRITO SE NOMBRA COMO POSIBLE, Y EN AFIRMATIVO.
    //
    // La primera redacción de este arreglo lo nombraba DOS VECES dentro de la
    // lista de limitaciones («un carrito puede sumar… PERO el pago se cierra
    // fuera», «un carrito, un favorito… son suyos y sólo suyos»). Medido el
    // 2026-08-27: el Agente lo leyó como el caso emblemático de lo limitado y
    // volvió a negarse — esta vez diciendo que podría hacerlo pero que sería
    // «una maqueta muerta». Un ejemplo dentro de una lista de peros ENSEÑA el
    // pero, no el ejemplo.
    expect(p).toMatch(/Un carrito \(botones que añaden/);
    expect(p).toContain("los construyes tú, aunque lo que guarden se quede en el navegador");
    expect(p).not.toContain("maqueta muerta\"");
    // Y el dato que dijo mal: localStorage NO se pierde al cerrar la pestaña.
    expect(p).toContain("SOBREVIVE a cerrar la pestaña");
    // Discutirle el negocio al usuario es la otra mitad de la negativa.
    expect(p).toContain("hazlo sin discutirle su negocio");
    expect(p).not.toContain("INTERACCIÓN CON JAVASCRIPT");
  });

  it("carries the hard rules and module knowledge", () => {
    const p = buildAgentSystemPrompt();
    // Los módulos que QUEDAN se encienden en vez de maquetarse; lo demás se
    // construye. La redacción vieja («NUNCA fabriques… login falso, calendario
    // falso») nombraba dos módulos retirados y prohibía construir lo que hoy
    // sí se puede.
    expect(p).toContain("Si algo YA EXISTE como módulo, enciéndelo");
    expect(p).toContain("Todo lo demás que viva en el navegador lo construyes TÚ");
    expect(p).toContain("activar_modulo");
    for (const m of AGENT_MODULES) expect(p).toContain(m);
    // Len 2.0 no trabaja con ids: ninguno de los dos marcadores se nombra.
    // `data-slot-path` sigue prohibido, pero desde el 2026-09-29 lo dice la
    // puerta y no el prompt: Write y Edit lo rechazan con su error
    // (herramientas-de-ficheros.test.ts, «marcador reservado»).
    expect(p).not.toContain("data-op-id");
    expect(p).not.toContain("data-slot-path");
  });

  it("🔴 el prompt no nombra ninguna herramienta retirada", () => {
    const p = buildAgentSystemPrompt();
    for (const vieja of [...RETIRADAS, "prueba_js", "ver_pagina", "incluir_documento", 'target="runtime"', "página activa"]) {
      expect(p, `el prompt nombra ${vieja}`).not.toContain(vieja);
    }
  });

  it("el prompt enseña a trabajar el sitio como ficheros: leer, cambiar el trozo, no reteclear", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("/index.html");
    expect(p).toContain("/<slug>/index.html");
    for (const h of ["Read", "Edit", "Write", "Grep"]) expect(p).toContain(h);
  });

  // H8 (2026-09-26): en E las tres taquerías reescribieron con Write una página
  // que ya tenía su diseño, para cumplir la guía, y perdieron el lema del dueño.
  it("H8 · la página que ya existe manda: se edita a su manera, la guía es para lo que Len crea", () => {
    const p = instruccionesDeLen();
    expect(p).toContain("Lo que añades a una página que ya existe se escribe como ella");
    expect(p).toContain("sus textos se quedan tal cual, palabra por palabra");
    expect(p).toContain("GUÍA DE DISEÑO (para las páginas que creas tú y para el rediseño que te pidan;");
    // El bloque oscuro, sólo en lo que crea (desde el 2026-09-29, con el
    // interruptor que Len elija: ver `vocabulario-ol` en publish-contract-min).
    expect(p).toContain("En una página que creas tú, escribe también su versión oscura");
    // La orden que empujaba a convertir la página entera ya no está.
    expect(p).not.toContain("Si la página aún no lo define, escríbelo tú");
    expect(p).not.toContain("Si la página aún no la tiene, escribe tú su versión oscura");
  });
  // MOTION, MÚSICA Y 3D salieron de esta lista el 2026-08-26 con sus
  // herramientas. Lo que sigue vigilado es que el prompt conozca las que
  // quedan y todos los presets de tema.
  // Y el prompt tampoco la nombra: una herramienta que ni está cargada ni se
  // puede cargar, anunciada, es una palanca a ninguna parte.
  it("el prompt ya no nombra preparar_marketing (retirada en Len 2.1)", () => {
    const p = buildAgentSystemPrompt();
    expect(p).not.toContain("preparar_marketing");
  });
  // El permiso de images.openlen.com vive desde el 2026-09-26 en la descripción
  // de `elegir_foto` (siempre cargada): la sección FOTOS del prompt repetía la
  // herramienta. Es lo que reconcilia la foto del catálogo con el «ninguna URL
  // de imagen externa» de la guía de diseño.
  it("carries the F2 Task 5 elegir_foto knowledge and the images.openlen.com permission note", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("elegir_foto");
    const d = (buildFunctionDeclarations() as { name: string; description: string }[]).find((x) => x.name === "elegir_foto")!.description;
    expect(d).toContain("images.openlen.com");
    expect(d).toMatch(/no cuenta como imagen externa/);
  });
  it("carries the F2 Task 6 editar_imagen knowledge: on-page-only, per-turn, and the elegir_foto cross-ref", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toContain("editar_imagen");
    expect(p).toContain("turno");
    expect(p).toContain("elegir_foto");
  });
  // Desde el 2026-09-26 esto vive en la DESCRIPCIÓN de `publicar`, no en el
  // prompt: el prompt lo repetía casi palabra por palabra, y en Claude Code lo
  // de cada herramienta va en su descripción.
  it("carries the F2 Task 7 publicar knowledge: always waits for the user's tap", () => {
    const d = (buildFunctionDeclarations() as { name: string; description: string }[]).find((x) => x.name === "publicar")!.description;
    // The hard rule — the agent never publishes directly; the tap is the gate.
    expect(d).toContain("subdominio");
    expect(d.toLowerCase()).toContain("tap");
    // The agent can add/set languages but never clear them — that's the
    // publish modal's job (the card omits `languages` when the list is empty).
    expect(d).toContain("QUITAR idiomas");
    expect(buildAgentSystemPrompt()).not.toContain("PUBLICAR (publicar)");
  });
  // Medido, no supuesto: con la redacción anterior DeepSeek reclamaba el
  // subdominio de MUESTRA —"mi-negocio", tomado del «p. ej.» de la propia
  // instrucción— 3 de 3 veces, y le enseñaba al usuario una tarjeta para
  // confirmar una dirección que jamás pidió. Gemini no caía, así que nada lo
  // habría delatado hasta que un usuario reclamara un nombre ajeno.
  //
  // Un ejemplo con forma de valor en la posición donde el modelo tiene que
  // NO poner un valor es una trampa, no una ayuda.
  it("nunca le ofrece al modelo un subdominio de muestra que pueda reclamar", () => {
    const p = buildAgentSystemPrompt();
    const publicar = buildFunctionDeclarations().find((d) => d.name === "publicar");
    const description = String((publicar as { description?: unknown }).description ?? "");
    for (const text of [p, description]) {
      expect(text).not.toMatch(/p\.\s?ej\.\s*[a-z0-9-]+\s*\)/i);
      expect(text).not.toContain("mi-negocio");
    }
    // Y la prohibición tiene que estar dicha, no sólo implícita. Desde el
    // 2026-09-26 se dice una vez, en la herramienta: el prompt la repetía.
    expect(description).toContain("NUNCA te lo inventes");
  });

  // RETIRADA el 2026-08-26, y es la más elocuente del barrido: fijaba que el
  // prompt le dijera al modelo «tu JavaScript NO sobrevive, la interactividad
  // es CSS o una CONDUCTA con nombre, nunca tu propio script».
  //
  // Era verdad cuando se escribió, y por eso existían las conductas: un
  // catálogo de recetas para aproximar lo que hace un `<script>`. Ahora el
  // script sobrevive porque es parte del documento, así que la frase pasó de
  // ser un aviso honesto a ser una mentira — y una prueba que la exigía la
  // habría mantenido viva.

  // INVERTIDA dos veces: el 2026-08-29 se cayó `intent="lista"` con las
  // colecciones, y en Len 2.1 (2026-09-30) la herramienta entera con «datos
  // vivos». Lo que el prompt no puede volver a llevar es ni la herramienta, ni
  // sus marcadores, ni el vocabulario de la colección.
  it("el prompt ya no lleva datos vivos ni colecciones", () => {
    const p = buildAgentSystemPrompt();
    expect(p).not.toContain("conectar_datos_vivos");
    expect(p).not.toContain("data-ol-live");
    expect(p).not.toContain('intent="lista"');
    // `solo lectura` a secas NO sirve como aserción: el prompt lo usa para
    // otras cosas legítimas —leer no muta, la búsqueda de fotos
    // tampoco—. Lo que no puede quedar es el vocabulario de la colección.
    expect(p.toLowerCase()).not.toContain("colección");
    expect(p.toLowerCase()).not.toContain("collections");
  });
  it("carries the link rule: user URLs verbatim, absolute, never invented, /<slug> for internal pages", () => {
    const p = instruccionesDeLen();
    expect(p).toContain("ENLACES");
    expect(p).toContain("VERBATIM");
    // The empty-destination fallback — an invented link is worse than none.
    expect(p).toContain('href="#"');
    // The why that makes the rule load-bearing: a scheme-less (or .html)
    // href is a relative path, and Caddy's `try_files … /index.html` serves
    // the HOME with 200 instead of 404ing — the break is invisible.
    expect(p).toContain("SILENCIOSO");
    expect(p).toContain("menu.html");
    expect(p).toContain("/<slug>");
  });

  // ── LÁPIDAS del 2026-08-29 ────────────────────────────────────────────────
  //
  // `collections` murió con el hub de Módulos: lo que hacía lo hace mejor un
  // almacén declarado en la página (hoy, /datos/<almacén>.json), sin nada que
  // activar. Estas aserciones no son ceremonia — un prompt que sigue ofreciendo
  // lo retirado hace que el modelo lo intente, falle, y el usuario pague el
  // turno. Ya pasó con Pedidos y con Reservas.
  it("🔴 `activar_modulo` acepta el asistente, no sólo el chat", () => {
    // Hasta el 2026-09-16 el asistente sólo se encendía desde un panel al que no
    // se llegaba. Que Len pueda encenderlo es la vía que encaja con la decisión
    // del 29/08: el dueño lo pide hablando, no yendo a un hub.
    expect([...AGENT_MODULES].sort()).toEqual(["assistant", "chat"]);
  });

  it("`collections` ya no es un módulo del Agente", () => {
    // `activar_modulo` SE QUEDA: es como se enciende el Chat. Lo que muere es
    // que `collections` sea uno de sus valores posibles.
    expect([...AGENT_MODULES]).toEqual(["chat", "assistant"]);
  });

  // ⚰️ Aquí vivía «datos vivos conserva valores y pierde lista» (2026-08-29).
  // Len 2.1 se llevó la herramienta entera: ver «conectar_datos_vivos ya no
  // está en el catálogo».

  it("ninguna descripción de herramienta ofrece colecciones", () => {
    const todo = buildFunctionDeclarations()
      .map((d) => (d as { description?: string }).description ?? "")
      .join(" ");
    expect(todo).not.toMatch(/collections/i);
  });

  it("el prompt del sistema tampoco", () => {
    expect(buildAgentSystemPrompt()).not.toMatch(/collections/i);
  });
});

// ── LO QUE EL AGENTE CREÍA QUE PODÍA, Y NO ───────────────────────────────────
//
// Las dos salen de una sesión real de un usuario (2026-08-31). Se miden sobre
// la CADENA QUE SE MANDA (`buildAgentSystemPrompt` / `buildFunctionDeclarations`)
// y no sobre el fichero: ninguna constante viaja tal cual, y este repo ya pagó
// tres veces por confundir el texto fuente con el prompt vivo.
describe("lo que el Agente cree que puede", () => {
  it("🔴 no ofrece un dominio de publicación escrito a mano", () => {
    const tools = JSON.stringify(buildFunctionDeclarations(process.env));
    // Le decía al usuario «por ejemplo lamarea.openlen.com» mientras producción
    // publica en .app desde el 2026-08-23. `images.openlen.com` es otra cosa —
    // el catálogo de fotos— y por eso se mira sólo el patrón de subdominio.
    expect(tools).not.toMatch(/<subdominio>\.openlen\.com/);
    expect(tools).toContain("<subdominio>.");
  });

  it("🔴 no sustituye lo que ya funciona por su propia alternativa", () => {
    const p = buildAgentSystemPrompt();
    // MEDIDO: el usuario tenía una sección de reseñas, se topó con un límite, y
    // el Agente le reescribió el formulario para que abriera WhatsApp. Nadie se
    // lo pidió, y su diagnóstico del límite era correcto — bastaba con decirlo.
    expect(p).toContain("no pongas tu alternativa en lugar de lo que ya funciona");
    // La otra mitad (no discutirle el negocio) cubre lo que el usuario PIDE;
    // ésta cubre lo que YA ESTÁ construido. Desde el 2026-09-29 van en la
    // MISMA regla, y se comprueban las dos porque la segunda se coló justo por
    // el hueco entre ambas cuando eran dos.
    expect(p).toContain("hazlo sin discutirle su negocio");
  });

  it("sabe que la navegación es de TODO el sitio, no de una página", () => {
    const p = buildAgentSystemPrompt();
    expect(p).toMatch(/LA NAVEGACIÓN ES DE TODO EL SITIO/);
    // Y la herramienta que lo hace posible en una sola llamada: buscar en
    // todos los ficheros a la vez.
    expect(p.slice(p.indexOf("LA NAVEGACIÓN ES DE TODO EL SITIO")).split(String.fromCharCode(10))[0]).toContain("Grep");
  });

  it("y comprueba lo que no controla ANTES de construirlo", () => {
    expect(buildAgentSystemPrompt()).toContain("Antes de construir algo que depende de lo que no controlas");
  });

  // ⚰️ AQUÍ SE EXIGÍA que el prompt siguiera diciendo «el BOTÓN FLOTANTE DE
  // CONTACTO no se borra editando la página, lo repinta el PERFIL DEL NEGOCIO,
  // apágalo desde “Barra de contacto flotante”». Retirado el 2026-09-01 junto
  // con la regla, porque era un test que SUJETABA UNA MENTIRA: sus tres
  // aserciones fijaban un mecanismo que ya no existe por ninguna de las tres
  // partes — el perfil se retiró el 2026-08-31, `lib/publish/whatsapp-button.ts`
  // ya no está, y `contactWidget` es una cadena i18n que NINGÚN componente lee.
  //
  // Mientras el test estuvo verde, el usuario que pedía quitar ese botón se
  // llevaba una negativa y una dirección a un interruptor inexistente.
  //
  // BRAZO DE CONTROL, que es lo que se queda: el prompt NO debe volver a
  // nombrar el mecanismo muerto. Si algún día se reconstruye el widget, esta
  // prueba falla y obliga a decidirlo a propósito en vez de por inercia.
  it("ya NO promete un botón flotante que el perfil repinta (mecanismo retirado)", () => {
    const p = buildAgentSystemPrompt();
    expect(p).not.toMatch(/BOTÓN FLOTANTE DE CONTACTO/);
    expect(p).not.toMatch(/Barra de contacto flotante/);
  });
});

// ─── LA CICATRIZ, DEL REVÉS (el sobre, tarea 5) ────────────────────────────
//
// El prompt narraba SIETE fallos pasados en segunda persona — «tú reescribiste
// ese formulario», «contestabas que OpenLen no tiene…», «borraste la 41»—, con
// su fecha y su reproche. Eso es few-shot NEGATIVO: la conducta que más veces
// aparece escrita, y con más detalle, es la mala.
//
// OpenCode resuelve la misma clase de problema con seis <example> que enseñan
// la conducta BUENA y cero narración de fallos. Aquí los hechos se quedan
// —qué es un formulario, dónde llega, qué guarda una versión— y lo que se fue
// es el relato del fallo.
//
// Esta prueba existe porque el arreglo se deshace solo: la forma natural de
// documentar un fallo medido es escribirlo, y sin nadie mirando vuelve.
describe("el prompt enseña la conducta buena, no narra la mala", () => {
  const p = () => buildAgentSystemPrompt();

  it("no le reprocha al modelo nada en segunda persona", () => {
    // Pasado de 2ª persona: es la forma que sólo aparece al narrarle un fallo.
    const reproche = /\b(reescribiste|montaste|contestaste|contestabas|arreglaste|borraste|inventaste|descubriste|dejaste al dueño)\b/g;
    const hallados = p().match(reproche) ?? [];
    expect(hallados, `el prompt volvió a narrar fallos: ${hallados.join(", ")}`).toEqual([]);
  });

  it("y enseña con ejemplos, que es lo que sustituye a la cicatriz", () => {
    const texto = p();
    const abiertos = (texto.match(/<ejemplo>/g) ?? []).length;
    const cerrados = (texto.match(/<\/ejemplo>/g) ?? []).length;
    // 6 desde la auditoría del 2026-09-29: salieron el del estudio de tatuajes
    // (su regla se juntó con la de las reseñas, que conserva el suyo) y el de
    // los formularios (el dato que enseñaba va ahora en la propia frase).
    expect(abiertos, "se quedó sin ejemplos: la regla volvió a ser sólo un NO").toBeGreaterThanOrEqual(6);
    expect(cerrados, "hay un <ejemplo> sin cerrar").toBe(abiertos);
  });

  it("tiene una sección de TONO, y va delante de las reglas", () => {
    // Medido antes de esta tarea: UNA línea de tono en 37.073 caracteres,
    // enterrada en mitad de las reglas duras.
    const texto = p();
    expect(texto).toContain("TONO:");
    // «REGLAS DURAS» pasó a «CÓMO TRABAJAR» en H4 (2026-09-26), con el
    // «Delivering work» de Claude Code dentro.
    expect(texto.indexOf("CÓMO TRABAJAR:")).toBeGreaterThan(0);
    expect(texto.indexOf("TONO:")).toBeLessThan(texto.indexOf("CÓMO TRABAJAR:"));
    expect(texto).toContain("Responde en el idioma en que te escribe el usuario");
  });
});

// 🔴 EL PROMPT NOMBRA UNA PARTE DE LA INTERFAZ: la vista «Datos» del editor,
// donde el dueño ve lo que guardan sus almacenes. Hacía falta —sin el sitio,
// Len se lo inventaba: MEDIDO el 2026-09-17, 5 de 5 cierres dijeron «tú los
// ves todos desde la Bandeja», que es la de los formularios—. Pero una regla
// que cita la UI caduca EN SILENCIO cuando esa parte se retira: un grep al
// borrar el componente encuentra sus imports, no su nombre dentro de una
// cadena de prompt. Esto la ata al componente.
describe("la vista «Datos» que el prompt nombra existe", () => {
  it("el lienzo ofrece la lente y en español se llama «Datos»", () => {
    expect(instruccionesDeLen()).toContain("la vista «Datos»");
    const lienzo = readFileSync(
      join(process.cwd(), "components/workspace-v2/preview-area.tsx"),
      "utf8",
    );
    expect(lienzo).toContain('value: "datos" as const');
    expect(lienzo).toContain("<DatosView");
    const chrome = JSON.parse(
      readFileSync(join(process.cwd(), "messages/es/wsChrome.json"), "utf8"),
    );
    expect(chrome.preview.lente).toEqual({
      pagina: "Vista previa",
      codigo: "Código",
      datos: "Datos",
      // F6a: la terminal de Len, sólo con la palanca o comandos guardados.
      terminal: "Terminal",
      // Lo que cambió en cada turno de la sesión, fichero a fichero.
      cambios: "Cambios",
    });
  });
});

// Len 2.0: el almacén se declara con Edit, dentro del <body>. La receta vieja
// (editar_html sobre un data-op-id) ya no existe en su camino.
describe("dónde se declara un almacén", () => {
  it("la receta de ALMACENES lo manda al body y con Edit, y su fichero es /datos/<almacén>.json", () => {
    const p = instruccionesDeLen();
    const seccion = p.slice(p.indexOf("ALMACENES (los datos de la página, en /datos)")).split(SALTO + SALTO)[0];
    expect(seccion).toContain("data-ol-stores");
    expect(seccion).toContain("<body>");
    // Borrar la tienda no debe llevarse el almacén (lo que enseñaba la vieja
    // `DONDE_SE_DECLARA_UN_ALMACEN`, retirada el 2026-09-25).
    expect(seccion).toContain("fuera de cualquier sección que se pueda borrar");
    expect(seccion).toContain("Edit");
    expect(seccion).toContain("/datos/<almacén>.json");
  });
});

// ── 🔴 UNA HERRAMIENTA QUE NO PUEDE CORRER NO SE DECLARA ────────────────────
//
// MEDIDO en la batería del 21/09: `mirar_pagina` se declara siempre, pero el
// arnés nunca cablea `deps.observarPagina`, así que la llamada devuelve
// «mirar_pagina no está disponible en este entorno». 2 de 8 casos la llamaron
// y se comieron una vuelta entera del modelo para recibir eso.
//
// Es la regla de la casa sobre las palancas, escrita en CLAUDE.md a propósito
// de los conmutadores de Gemini: se BORRARON en vez de dejarlos apagados,
// «porque una palanca que no apunta a nada se lee como una alternativa que
// existe». Una herramienta declarada es exactamente eso.
describe("el catálogo declara lo que de verdad puede correr", () => {
  it("🔴 sin observarPagina, `mirar_pagina` NO se declara", () => {
    const con = buildFunctionDeclarations({}).map((d) => d.name);
    const sin = buildFunctionDeclarations({}, { mirarPagina: false }).map((d) => d.name);
    expect(con).toContain("mirar_pagina");
    expect(sin).not.toContain("mirar_pagina");
    // Y NO SE LLEVA NADA MÁS POR DELANTE: sólo esa.
    expect(sin).toEqual(con.filter((n) => n !== "mirar_pagina"));
  });

  it("🔴 sin usarPagina, `usar_pagina` NO se declara, y las dos se apagan por separado", () => {
    const con = buildFunctionDeclarations({}).map((d) => d.name);
    const sin = buildFunctionDeclarations({}, { usarPagina: false }).map((d) => d.name);
    expect(con).toContain("usar_pagina");
    expect(sin).toEqual(con.filter((n) => n !== "usar_pagina"));
    const ninguna = buildFunctionDeclarations({}, { usarPagina: false, mirarPagina: false }).map((d) => d.name);
    expect(ninguna).toEqual(con.filter((n) => n !== "usar_pagina" && n !== "mirar_pagina"));
  });

  // CONTRA-PRUEBA: el defecto es declararla. Producción la tiene cableada, así
  // que omitir por omisión habría apagado la herramienta en el producto.
  it("CONTRA-PRUEBA: por omisión se sigue declarando", () => {
    expect(buildFunctionDeclarations({}).map((d) => d.name)).toContain("mirar_pagina");
  });
});
