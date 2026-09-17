import { describe, expect, it } from "vitest";
import { bakeAssistantWidget } from "./assistant-widget";

const DOC = "<!doctype html><html><body><h1>Hi</h1></body></html>";
const CFG = {
  sub: "tacos",
  apiBase: "https://openlen.com",
  businessName: "Tacos La Norteña",
};

describe("bakeAssistantWidget", () => {
  it("injects the IIFE right before </body>", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    expect(out).toContain("data-openlen-assistant");
    expect(out.indexOf("data-openlen-assistant")).toBeLessThan(
      out.indexOf("</body>"),
    );
    expect(out).toContain("attachShadow");
  });

  it("is idempotent — a second bake is a no-op", () => {
    const once = bakeAssistantWidget(DOC, CFG);
    const twice = bakeAssistantWidget(once, CFG);
    expect(twice).toBe(once);
    expect(twice.match(/data-openlen-assistant/g)).toHaveLength(1);
  });

  it("wires both endpoints with the configured base + sub", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    expect(out).toContain('"api":"https://openlen.com"');
    expect(out).toContain('"sub":"tacos"');
    // Runtime concatenates api+"/api/assistant/"+sub and api+"/api/f/"+sub.
    expect(out).toContain('/api/assistant/');
    expect(out).toContain('/api/f/');
  });

  it("defaults greeting from the business name and keeps branding", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    expect(out).toContain("Tacos La Norteña");
    expect(out).toContain("openlen.com");
  });

  it("ships the 10 locales and picks one from <html lang> at runtime", () => {
    const out = bakeAssistantWidget(DOC, CFG);
    for (const l of ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "nl"]) {
      expect(out).toContain(`"${l}":{"open":`);
    }
    expect(out).toContain("document.documentElement.lang");
    expect(out).toContain("C.S.en"); // unknown lang falls back to English
  });

  it("bakes no UI text into the markup — labels come from the locale table", () => {
    const out = bakeAssistantWidget(DOC, { ...CFG, chatHandoff: true });
    expect(out).not.toContain('aria-label="Abrir chat de ayuda"');
    expect(out).not.toContain(">Hablar con una persona<");
    expect(out).toContain('"greeting":null');
    expect(out).toContain('T.greeting.split("{name}")');
  });

  it("keeps a configured greeting verbatim", () => {
    const out = bakeAssistantWidget(DOC, { ...CFG, greeting: "Buenas 🌮" });
    expect(out).toContain('"greeting":"Buenas 🌮"');
  });

  it("drives the branding footer from config (runtime-gated)", () => {
    expect(bakeAssistantWidget(DOC, CFG)).toContain('"branding":true');
    expect(
      bakeAssistantWidget(DOC, { ...CFG, branding: false }),
    ).toContain('"branding":false');
  });

  it("appends when there is no </body>", () => {
    const out = bakeAssistantWidget("<h1>fragment</h1>", CFG);
    expect(out).toContain("data-openlen-assistant");
  });

  it("JSON-escapes config so a quote in the name can't break out", () => {
    const out = bakeAssistantWidget(DOC, {
      ...CFG,
      businessName: 'Bob"s </script> Tacos',
    });
    // The business name is JSON-encoded inside the config blob and every "<" is
    // \u003c-escaped, so the literal </script> can never close the tag early.
    expect(out).toContain('Bob\\"s');
    expect(out).toContain("\\u003c/script>");
  });

  // EL ICONO DE LA BURBUJA TIENE QUE LEERSE CON CUALQUIER ACENTO.
  //
  // Aqui habia un color:#fff a pelo sobre el acento, en seis sitios. MEDIDO el
  // 2026-09-16: blanco sobre #f5c542 da 1,62:1, sobre #7dd3fc 1,67:1 y sobre
  // #34d399 1,92:1, contra el umbral de 3:1 de un elemento no textual.
  //
  // 🔴 Y NO LO VEIA NADIE. La burbuja monta en shadow DOM y la pasada
  // determinista recorre el documento claro: medido sobre las 231 plantillas
  // del corpus, no ve el boton en 443 de 462 miradas. Este defecto no podia
  // salir por ningun lado, ni al usuario ni al modelo.
  describe("el icono se calcula, no se asume blanco", () => {
    /** La misma funcion que va inyectada, sacada del script para poder
     *  ejercitarla sin navegador. Si alguien cambia la del widget y no esta,
     *  el primer `it` de abajo se pone rojo. */
    function fgDelWidget(script: string): (a: string) => string {
      const m = /var FG=\(function\(a\)\{[\s\S]*?\}\)\(ACC\);/.exec(script);
      if (!m) throw new Error("no esta la funcion FG en el script inyectado");
      const cuerpo = m[0].replace("var FG=", "return ").replace("(ACC);", ";");
      return new Function(cuerpo)() as (a: string) => string;
    }

    it("🔴 un acento CLARO deja de llevar icono blanco", () => {
      const fg = fgDelWidget(bakeAssistantWidget(DOC, CFG));
      // Los tres medidos, y el blanco puro que es el caso limite.
      expect(fg("#f5c542")).toBe("#1a1a1a");
      expect(fg("#7dd3fc")).toBe("#1a1a1a");
      expect(fg("#34d399")).toBe("#1a1a1a");
      expect(fg("#ffffff")).toBe("#1a1a1a");
    });

    it("🔴 MINIMA INTERVENCION: lo que ya funcionaba no se toca", () => {
      // El acento por defecto cumple (3,10:1). Con la regla de "el que mas
      // contraste da" pasaba a icono casi negro, o sea que le cambiaba la cara
      // a todas las paginas publicadas sin que nadie lo pidiera. Esta prueba es
      // la que impide volver a esa regla.
      const fg = fgDelWidget(bakeAssistantWidget(DOC, CFG));
      expect(fg("#FF5A36")).toBe("#fff");
      expect(fg("#1f5f4f")).toBe("#fff");
      expect(fg("#111111")).toBe("#fff");
    });

    it("una entrada que no es un color no rompe la burbuja", () => {
      const fg = fgDelWidget(bakeAssistantWidget(DOC, CFG));
      expect(fg("rojo")).toBe("#fff");
      expect(fg("")).toBe("#fff");
    });

    it("BRAZO DE CONTROL: ya no queda un blanco a pelo sobre el acento", () => {
      // Sin esto, alguien puede anadir un septimo sitio con color:#fff y las
      // pruebas de arriba siguen verdes porque la funcion FG sigue bien.
      const out = bakeAssistantWidget(DOC, CFG);
      expect(out).not.toContain("+ACC+';color:#fff");
    });
  });
});

// LA BURBUJA SE ESCONDE SOLA.
//
// El widget va HORNEADO en la release, así que apagar el asistente en el taller
// no lo quita de la página publicada: seguía ahí y, al preguntarle, devolvía
// «Hubo un problema. Intenta de nuevo en un momento.» — un 403 «disabled»
// disfrazado de avería pasajera. MEDIDO el 2026-09-16 en el dev.
//
// Estas pruebas EJECUTAN el script horneado: el entorno jsdom de vitest lleva
// `runScripts: "dangerously"`, así que el widget arranca solo al escribir el
// documento. Lo que hay que comprobar es que el anfitrión desaparece del DOM;
// una aserción sobre la cadena horneada pasaría igual con el widget roto.
//
// 🔴 EL DOBLE DE `fetch` VA DENTRO DE LA PÁGINA, y esto costó media hora:
// jsdom corre los scripts de la página en SU PROPIO objeto global, que no es el
// `window` que ve el test —comprobado con una sonda: `window.__x` puesto por la
// página sale `undefined` desde aquí, aunque `document.defaultView === window`—.
// Un `vi.stubGlobal("fetch", …)` se queda en el global del test y la página
// sigue viendo `fetch is not defined`, que el try/catch del widget se traga
// entera. Lo que SÍ comparten los dos mundos es el DOM, así que el doble se
// inyecta en un <script> propio y contesta por un atributo de <body>.
const sonda = (cuerpo: string) =>
  `<!doctype html><html><body><h1>Hi</h1><script>${cuerpo}<\/script></body></html>`;

const conEstado = (estado: Record<string, boolean>) =>
  sonda(
    `window.__e=${JSON.stringify(estado)};` +
      `window.fetch=function(u){document.body.setAttribute("data-pedido",String(u));` +
      `return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve(window.__e)}})};` +
      `window.__openlenChat={mostrarLanzador:function(){document.body.setAttribute("data-lanzador","si")}};`,
  );

describe("el estado decide si la burbuja se queda", () => {
  const pintar = (html: string, cfg: Partial<typeof CFG> & { chatHandoff?: boolean } = {}) => {
    document.open();
    document.write(bakeAssistantWidget(html, { ...CFG, ...cfg }));
    document.close();
    // El estado llega en una promesa: hay que dejar pasar los turnos.
    return new Promise((r) => setTimeout(r, 5));
  };
  const anfitrion = () => document.querySelector("body > div[aria-live]");

  it("🔴 apagado: el anfitrión se va del DOM entero", async () => {
    document.open();
    document.write(bakeAssistantWidget(conEstado({ asistente: false, chat: false }), CFG));
    document.close();
    // Se pinta PRIMERO: la visita normal no espera a Node para ver su burbuja.
    expect(anfitrion()).not.toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect(document.body.getAttribute("data-pedido")).toBe(
      "https://openlen.com/api/assistant/tacos",
    );
    expect(anfitrion()).toBeNull();
  });

  it("BRAZO DE CONTROL: encendido, sigue donde estaba", async () => {
    await pintar(conEstado({ asistente: true, chat: false }));
    expect(anfitrion()).not.toBeNull();
  });

  it("🔴 si el estado no llega, NO se toca: borrar una burbuja viva es peor", async () => {
    await pintar(sonda('window.fetch=function(){return Promise.reject(new Error("sin red"))};'));
    expect(anfitrion()).not.toBeNull();
  });

  it("🔴 con lanzador fusionado y el CHAT apagado, se va el botón de la persona", async () => {
    // Ese botón lleva a /api/chat/<sub>/handoff, que con el chat apagado da 404.
    await pintar(conEstado({ asistente: true, chat: false, traspaso: false }), { chatHandoff: true });
    expect((anfitrion() as HTMLElement).shadowRoot!.querySelector(".talk")).toBeNull();
  });

  it("🔴 y con el chat ENCENDIDO pero cerrado al público, también: el traspaso no es el chat", async () => {
    // El handoff acuña un invitado, así que además del chat encendido pide que
    // sea un espacio de invitado y de entrada libre (handoff/route.ts:52-53).
    // Mirando sólo `chat`, el dueño que pasa su chat a modo cuenta se quedaba
    // con el botón puesto dando 403 not_allowed — el mismo error disfrazado de
    // avería que todo esto viene a quitar, en el botón de al lado.
    await pintar(conEstado({ asistente: true, chat: true, traspaso: false }), { chatHandoff: true });
    const host = anfitrion() as HTMLElement;
    expect(host.shadowRoot!.querySelector(".talk")).toBeNull();
    expect(host.shadowRoot!.querySelector(".btn")).not.toBeNull(); // el asistente se queda
  });

  it("BRAZO DE CONTROL: con los dos encendidos el botón de la persona se queda", async () => {
    await pintar(conEstado({ asistente: true, chat: true, traspaso: true }), { chatHandoff: true });
    expect((anfitrion() as HTMLElement).shadowRoot!.querySelector(".talk")).not.toBeNull();
  });

  it("BRAZO DE CONTROL: un estado que no trae el traspaso no toca el botón", async () => {
    // Lo que no se sabe no se retira. Vale igual para una respuesta a medias que
    // para una release horneada contra una versión vieja del endpoint.
    await pintar(conEstado({ asistente: true, chat: true }), { chatHandoff: true });
    expect((anfitrion() as HTMLElement).shadowRoot!.querySelector(".talk")).not.toBeNull();
  });

  it("🔴 asistente apagado y chat encendido: le devuelve el lanzador al chat", async () => {
    // Fusionados comparten UNA burbuja, y es la del asistente. Sin esto el chat
    // se queda encendido y sin puerta ninguna para el visitante.
    await pintar(conEstado({ asistente: false, chat: true }), { chatHandoff: true });
    expect(anfitrion()).toBeNull();
    expect(document.body.getAttribute("data-lanzador")).toBe("si");
  });

  it("BRAZO DE CONTROL: si el asistente se queda, al chat no se le toca el lanzador", async () => {
    await pintar(conEstado({ asistente: true, chat: true }), { chatHandoff: true });
    expect(document.body.getAttribute("data-lanzador")).toBeNull();
  });
});

// EL 403 A MITAD DE VISITA.
//
// El caso que destapó la revisión del 2026-09-17: el visitante carga la página
// con el asistente encendido —su navegador cachea «sí» 60 s—, el dueño lo apaga,
// y el visitante manda su mensaje. El POST contesta 403. Si ahí sólo se vuelve a
// preguntar el estado con la caché puesta, se relee el «sí» viejo, no se retira
// nada y NO se pinta nada: el visitante ve su mensaje evaporarse sin respuesta y
// sin error, peor que antes de todo esto.
//
// El 403 de esta ruta sólo significa «disabled», así que es autoritativo: el
// widget se va. El estado se vuelve a pedir SIN caché y sólo para lo que el 403
// no dice — si el chat sigue vivo, para devolverle su lanzador.
describe("un 403 al preguntar retira la burbuja", () => {
  const anfitrion = () => document.querySelector("body > div[aria-live]");

  const pintarConPost403 = async (chatVivo: boolean) => {
    const pagina =
      `<!doctype html><html lang="es"><body><main>hi</main><script>` +
      `window.__pedidas=[];` +
      `window.fetch=function(u,o){window.__pedidas.push(((o&&o.method)||"GET")+" "+((o&&o.cache)||"caché"));` +
      `document.body.setAttribute("data-peticiones",window.__pedidas.join("|"));` +
      `if(o&&o.method==="POST")return Promise.resolve({ok:false,status:403,json:function(){return Promise.resolve({error:"disabled"})}});` +
      // El GET perezoso dice que sigue vivo (es el "sí" cacheado); el fresco, la verdad.
      `var vivo=!(o&&o.cache==="no-store");` +
      `return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({asistente:vivo,chat:${chatVivo},traspaso:${chatVivo}})}})};` +
      `window.__openlenChat={mostrarLanzador:function(){document.body.setAttribute("data-lanzador","si")}};` +
      `<\/script></body></html>`;
    document.open();
    document.write(bakeAssistantWidget(pagina, { ...CFG, chatHandoff: true }));
    document.close();
    await new Promise((r) => setTimeout(r, 5));
    const host = anfitrion() as HTMLElement;
    const R = host.shadowRoot!;
    (R.querySelector(".btn") as HTMLButtonElement).click(); // abre el panel
    (R.querySelector(".ip input") as HTMLInputElement).value = "¿abren hoy?";
    R.querySelector("form.ip")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  };

  it("🔴 se va, y NO se queda callada con la burbuja puesta", async () => {
    await pintarConPost403(false);
    expect(anfitrion()).toBeNull();
    // La segunda lectura del estado tuvo que saltarse la caché, o habría leído
    // el «sí» viejo y no se habría ido.
    expect(document.body.getAttribute("data-peticiones")).toMatch(/no-store/);
  });

  it("y si el chat sigue vivo, le deja su lanzador al irse", async () => {
    await pintarConPost403(true);
    expect(anfitrion()).toBeNull();
    expect(document.body.getAttribute("data-lanzador")).toBe("si");
  });
});
