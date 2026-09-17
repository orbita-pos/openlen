import { describe, expect, it } from "vitest";
import { bakeChatWidget } from "@/lib/publish/chat-widget";
import { bakeAssistantWidget } from "@/lib/publish/assistant-widget";

const BASE = `<!doctype html><html lang="es"><body><main>hi</main></body></html>`;
const cfg = { sub: "demo", accent: "#7C3AED", mount: "fab" as const, selfServeJoin: true };

describe("bakeChatWidget", () => {
  it("injects the widget before </body> and is idempotent", () => {
    const once = bakeChatWidget(BASE, cfg);
    expect(once).toContain("data-ol-chat-widget");
    expect(once.indexOf("</body>")).toBeGreaterThan(once.indexOf("data-ol-chat-widget"));
    expect(bakeChatWidget(once, cfg)).toBe(once); // second bake is a no-op
  });
  it("fills the data-ol-chat-section placeholder in section mode", () => {
    const withSection = `<!doctype html><html lang="es"><body><div data-ol-chat-section></div></body></html>`;
    const out = bakeChatWidget(withSection, { ...cfg, mount: "section" });
    expect(out).toContain("data-ol-chat-widget");
    expect(out).toMatch(/data-ol-chat-section[^>]*>[\s\S]*data-ol-chat-widget/);
  });
  it("never emits data-slot-path and escapes < in config", () => {
    const out = bakeChatWidget(BASE, cfg);
    expect(out).not.toContain("data-slot-path");
    expect(out).not.toContain("</script><");
    expect(out).toContain("#7C3AED");
  });

  // Restyle WhatsApp 2026-07-15
  it("un acento que no es hex NO se interpola al CSS (guard anti-inyección)", () => {
    const out = bakeChatWidget(BASE, { ...cfg, accent: "red}body{background:url(//evil)" });
    expect(out).not.toContain("evil");
    expect(out).toContain("#FF5A36"); // cae al default
  });

  it("sin acento configurado cae al coral OpenLen (#FF5A36), no a un color inventado", () => {
    const out = bakeChatWidget(BASE, { sub: "demo", mount: "fab", selfServeJoin: true });
    expect(out).toContain("#FF5A36");
  });

  // Apilamiento de burbujas: el asistente ocupa los 18 px de la esquina, así
  // que un chat que NO se fusiona con él se hornea una ranura arriba.
  it("bakes the caller's bottom offset into the FAB and the panel", () => {
    const out = bakeChatWidget(BASE, { ...cfg, bottomPx: 86 });
    expect(out).toContain('"bottom":86');
    const own = bakeChatWidget(BASE, cfg);
    expect(own).not.toContain('"bottom"'); // sin offset = 18 px por default
  });

  it("skips the API calls when there is no sub (draft preview shell only)", () => {
    const out = bakeChatWidget(BASE, { ...cfg, sub: "" });
    expect(out).toContain("if(!C.sub){authView();return}");
  });

  it("el script trae la piel WhatsApp: avatar del header, papel tapiz y timestamps", () => {
    const out = bakeChatWidget(BASE, cfg);
    expect(out).toContain('"ava"'); // avatar circle en el header
    expect(out).toContain("radial-gradient"); // papel tapiz
    expect(out).toContain("fmtT"); // formateador de hora de burbuja
    expect(out).toContain('"hello"'); // saludo como burbuja en el form
    // el acento configurado sigue mandando sobre el default
    expect(out).toContain("#7C3AED");
  });
});

// EL FOCO ES DEL VISITANTE, NO DEL WIDGET.
//
// MEDIDO el 2026-09-16 en móvil, con el chat en modo sección: la vista de
// invitado se pinta AL CARGAR la página, y enfocaba «Tu nombre» sola. El
// visitante estaba escribiéndole al asistente; el resto de lo que tecleó y el
// Enter se fueron al chat, y su pregunta no salió nunca. En un teléfono además
// desplaza la página y abre el teclado sin que nadie toque nada.
//
// Estas pruebas EJECUTAN el script horneado en jsdom en vez de mirar la cadena:
// «no aparece .focus()» pasaría igual si el widget se rompiera entero. Con
// `sub` vacío el arranque no llama a la API (es la trampilla de la vista
// previa), así que la vista de invitado se pinta sin red de por medio.
describe("el foco del chat incrustado", () => {
  const pintar = (html: string) => {
    document.open();
    document.write(html);
    document.close();
    // El script corre SOLO: el entorno jsdom de vitest lleva
    // `runScripts: "dangerously"`, asi que el widget ya arranco dentro del
    // document.write y para cuando volvemos el anfitrion tiene su shadowRoot.
    // Ejecutar el texto a mano ademas seria un no-op —`instance()` sale por su
    // guarda de `if(host.shadowRoot)return`—, y una linea que no sujeta nada
    // parece que sujeta algo. Medido con una sonda el 2026-09-16.
    return document.querySelector("[data-ol-chat-host]") as HTMLElement;
  };
  const invitado = { ...cfg, sub: "", identityMode: "guest" as const };

  it("🔴 en modo sección NO enfoca al cargar: el visitante no lo abrió", async () => {
    const host = pintar(
      bakeChatWidget(
        `<!doctype html><html lang="es"><body><div data-ol-chat-section></div></body></html>`,
        { ...invitado, mount: "section" },
      ),
    );
    // El foco se pedía en un setTimeout(…, 0): hay que dejar pasar el turno.
    await new Promise((r) => setTimeout(r, 5));
    expect(host.shadowRoot!.querySelector("input")).not.toBeNull(); // se pintó
    expect(host.shadowRoot!.activeElement).toBeNull();
  });

  it("y con la burbuja, abrirla SÍ enfoca — que es lo que el visitante pidió", async () => {
    // El brazo de control de la de arriba: si el arreglo fuese «quitar el
    // foco», esto se caería y diría que se perdió la comodidad que sí valía.
    const host = pintar(
      bakeChatWidget(`<!doctype html><html lang="es"><body><main>hi</main></body></html>`, {
        ...invitado,
        mount: "fab",
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(host.shadowRoot!.activeElement).toBeNull(); // cerrada, nada enfocado
    (host.shadowRoot!.querySelector("button.fab") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 5));
    expect(host.shadowRoot!.activeElement).toBe(host.shadowRoot!.querySelector("input"));
  });
});

// EL CHAT APAGADO TAMBIÉN SE RETIRA.
//
// Mismo origen que la burbuja del asistente: el widget va horneado, así que
// apagar el chat deja el panel en la página con TODAS sus rutas devolviendo 404
// (`loadChatSite` → `chatEnabled`). En modo sección eso es un formulario de
// acceso pintado al cargar que no puede funcionar.
//
// El doble de `fetch` va DENTRO de la página por la misma razón que en
// assistant-widget.test.ts: jsdom corre los scripts de la página en su propio
// objeto global y el `window` del test no es ése. El DOM sí es compartido.
const paginaChat = (estado: number, extra = "") =>
  `window.fetch=function(u){document.body.setAttribute("data-pedido",String(u));` +
  `return Promise.resolve({status:${estado},ok:${estado < 300},json:function(){return Promise.resolve({})}})};${extra}`;

const docConChat = (cuerpo: string, seccion: boolean) =>
  `<!doctype html><html lang="es"><body>${seccion ? '<div data-ol-chat-section></div>' : "<main>hi</main>"}` +
  `<script>${cuerpo}<\/script></body></html>`;

describe("el chat apagado se retira de la página", () => {
  const vivo = { ...cfg, sub: "demo", identityMode: "guest" as const };
  const pintar = (estado: number, opciones: { seccion: boolean; handoff?: boolean }) => {
    document.open();
    document.write(
      bakeChatWidget(docConChat(paginaChat(estado), opciones.seccion), {
        ...vivo,
        mount: opciones.seccion ? "section" : "fab",
        chatAsHandoffTarget: opciones.handoff,
      }),
    );
    document.close();
    return new Promise((r) => setTimeout(r, 5));
  };
  const anfitrion = () => document.querySelector("[data-ol-chat-host]");
  /** Ejecuta JS EN LA PÁGINA — un <script> añadido al DOM sí corre en su global. */
  const enLaPagina = (js: string) => {
    const s = document.createElement("script");
    s.textContent = js;
    document.body.appendChild(s);
  };

  it("🔴 en sección, un 404 al arrancar se lleva el anfitrión entero", async () => {
    await pintar(404, { seccion: true });
    expect(document.body.getAttribute("data-pedido")).toBe("/api/chat/demo/me");
    expect(anfitrion()).toBeNull();
  });

  it("BRAZO DE CONTROL: en sección, con el chat vivo el panel se queda", async () => {
    await pintar(200, { seccion: true });
    expect(anfitrion()).not.toBeNull();
  });

  it("🔴 la burbuja propia pregunta al CARGAR, para poder esconderse sin que la abran", async () => {
    // Antes no llamaba a nada hasta que el visitante la abría, así que una
    // burbuja muerta se veía igual que una viva hasta el primer clic.
    await pintar(404, { seccion: false });
    expect(document.body.getAttribute("data-pedido")).toBe("/api/chat/demo/me");
    expect(anfitrion()).toBeNull();
  });

  it("BRAZO DE CONTROL: la burbuja viva sigue en su sitio", async () => {
    await pintar(200, { seccion: false });
    expect(anfitrion()).not.toBeNull();
    expect((anfitrion() as HTMLElement).shadowRoot!.querySelector("button.fab")).not.toBeNull();
  });

  it("🔴 fusionado: mostrarLanzador() crea la burbuja que no se horneó", async () => {
    // Con traspaso, el chat se hornea SIN burbuja propia: la puerta es la del
    // asistente. Si el asistente se apaga, ésta es la que se la devuelve.
    await pintar(200, { seccion: false, handoff: true });
    const host = anfitrion() as HTMLElement;
    expect(host.shadowRoot!.querySelector("button.fab")).toBeNull();
    enLaPagina("window.__openlenChat.mostrarLanzador()");
    expect(host.shadowRoot!.querySelector("button.fab")).not.toBeNull();
  });

  it("y llamarlo dos veces no deja dos burbujas", async () => {
    await pintar(200, { seccion: false, handoff: true });
    const host = anfitrion() as HTMLElement;
    enLaPagina("window.__openlenChat.mostrarLanzador();window.__openlenChat.mostrarLanzador()");
    expect(host.shadowRoot!.querySelectorAll("button.fab")).toHaveLength(1);
  });
});

// LAS DOS MITADES, EN LA MISMA PÁGINA.
//
// Las pruebas de arriba comprueban cada lado por separado: el asistente LLAMA a
// `mostrarLanzador` (con un doble) y el chat lo EXPONE. Que las dos frases sean
// ciertas por separado no prueba que se encuentren — el nombre del método, el
// orden de arranque o el `window` en el que vive cada uno pueden no coincidir.
// Esto hornea los dos widgets en un mismo documento, como hace publishToDir con
// el traspaso, y mira el resultado.
describe("asistente apagado + chat encendido, horneados juntos", () => {
  it("🔴 la burbuja del asistente se va y el chat recupera la suya", async () => {
    const pagina =
      `<!doctype html><html lang="es"><body><main>hi</main><script>` +
      `window.fetch=function(u){u=String(u);` +
      `if(u.indexOf("/api/assistant/")>-1)return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({asistente:false,chat:true})}});` +
      `return Promise.resolve({ok:true,status:200,json:function(){return Promise.resolve({})}})};` +
      `<\/script></body></html>`;
    // El mismo orden que publishToDir: el chat primero, el asistente al final.
    const conChat = bakeChatWidget(pagina, {
      ...cfg,
      sub: "demo",
      chatAsHandoffTarget: true,
    });
    document.open();
    document.write(
      bakeAssistantWidget(conChat, {
        sub: "demo",
        apiBase: "https://openlen.com",
        businessName: "Tacos",
        chatHandoff: true,
      }),
    );
    document.close();
    await new Promise((r) => setTimeout(r, 10));

    expect(document.querySelector("body > div[aria-live]")).toBeNull(); // el asistente, fuera
    const chat = document.querySelector("[data-ol-chat-host]") as HTMLElement;
    expect(chat).not.toBeNull();
    expect(chat.shadowRoot!.querySelector("button.fab")).not.toBeNull(); // con puerta
  });
});
