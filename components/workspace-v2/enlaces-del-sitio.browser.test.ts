// LOS ENLACES DEL SITIO, CON UN NAVEGADOR DE VERDAD.
//
// Esto no se puede medir en jsdom. Lo que falla es cómo un `<iframe srcdoc>`
// resuelve un href relativo —contra la página que lo contiene, no contra el
// sitio del usuario— y eso es comportamiento de navegador, no de una función.
// La prueba monta el mismo montaje que el taller: una página padre con un
// iframe `srcdoc`, el script inyectado dentro, y se pulsan enlaces de verdad.
//
// Lo que se clava: que el iframe NO se vaya a ninguna parte. Ése era el fallo
// —pulsabas «menú» en tu propia navegación y el lienzo se iba a la app de
// OpenLen— y es invisible en cualquier prueba que no sea un navegador.
import { describe, expect, it, afterAll } from "vitest";
import { createServer, type Server } from "node:http";

import { injectPageLinks } from "./use-page-links";

const PAGINA = injectPageLinks(
  "<!doctype html><html><head><title>t</title></head><body>" +
    "<nav>" +
    '<a id="home" href="/">Inicio</a>' +
    '<a id="menu" href="/menu">Menú</a>' +
    '<a id="barra" href="/contacto/">Contacto</a>' +
    '<a id="fantasma" href="/no-existe">Fantasma</a>' +
    '<a id="portada-seccion" href="/#artistas">Artistas</a>' +
    '<a id="ancla" href="#precios">Precios</a>' +
    '<a id="fuera" href="https://instagram.com/x">Instagram</a>' +
    '<a id="correo" href="mailto:hola@x.com">Correo</a>' +
    "</nav>" +
    '<section id="precios" style="margin-top:2000px;height:200px">Precios</section>' +
    "</body></html>",
);

let server: Server | null = null;
afterAll(() => server?.close());

describe("un clic en un enlace del sitio, dentro del lienzo", () => {
  it("no se lleva el iframe y le dice al padre a dónde ir", async () => {
    // El padre: un iframe srcdoc, igual que PreviewArea, y un buzón para lo
    // que llegue por postMessage.
    // El `srcdoc` se pone DESDE JavaScript, no como atributo. Escribirlo en el
    // atributo obliga a escapar sus comillas a mano y el documento lleva las
    // suyas dentro de otro `<script>`: la primera versión de esta prueba montó
    // un iframe vacío por eso, y el fallo se leía como «el manejador no
    // funciona» en vez de «mi montaje está mal».
    const PADRE =
      "<!doctype html><html><body>" +
      "<script>window.__recibidos = [];" +
      "window.addEventListener('message', function (e) { window.__recibidos.push(e.data); });" +
      "</script>" +
      '<iframe id="lienzo" style="width:600px;height:400px"></iframe>' +
      "<script>document.getElementById('lienzo').srcdoc = __DOC__;</script>" +
      "</body></html>";

    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      // JSON.stringify escapa por nosotros; `</` se parte para que el parser
      // del padre no cierre su propio <script> al ver el del documento.
      const literal = JSON.stringify(PAGINA).replace(/<\//g, "<\\/");
      res.end(PADRE.replace("__DOC__", () => literal));
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const dir = server!.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      const base = `http://127.0.0.1:${dir.port}/`;
      await page.goto(base, { waitUntil: "load", timeout: 20_000 });

      // El `srcdoc` se asigna desde un script, así que el documento del iframe
      // se sustituye DESPUÉS del load del padre: hay que esperar a que su
      // contenido esté, no a que el elemento exista.
      const lienzo = async () => {
        for (let i = 0; i < 60; i++) {
          for (const f of page.frames()) {
            if (f === page.mainFrame()) continue;
            const listo = await f
              .evaluate("!!document.getElementById('menu')")
              .catch(() => false);
            if (listo) return f;
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error("el iframe nunca cargó el documento");
      };
      const frame = await lienzo();

      const pulsar = async (id: string) => {
        await frame.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
        await new Promise((r) => setTimeout(r, 60));
      };
      const recibidos = () =>
        page.evaluate("window.__recibidos.filter(function(m){return m && m.type === 'openlen:ir-a-pagina';})") as Promise<
          Array<{ slug: string; href: string }>
        >;

      // ── una página del sitio ────────────────────────────────────────────
      await pulsar("menu");
      expect((await recibidos()).at(-1)?.slug).toBe("menu");

      // ── la barra final es la misma página ───────────────────────────────
      await pulsar("barra");
      expect((await recibidos()).at(-1)?.slug).toBe("contacto");

      // ── la portada viaja como cadena vacía, que es como el padre lee null ─
      await pulsar("home");
      expect((await recibidos()).at(-1)?.slug).toBe("");

      // ── una que no existe TAMBIÉN se avisa: publicada, ese enlace serviría
      //    la portada con un 200 y parecería funcionar ───────────────────────
      await pulsar("fantasma");
      const ultimo = (await recibidos()).at(-1);
      expect(ultimo?.slug).toBe("no-existe");
      expect(ultimo?.href).toBe("/no-existe");

      // ── LO QUE DE VERDAD IMPORTA: el lienzo no se ha movido ──────────────
      //
      // Si el manejador fallara, el iframe estaría en /menu de la app de
      // OpenLen y el usuario habría perdido su página de vista. Es el fallo
      // entero, y es lo único que jsdom no puede ver.
      expect(frame.url()).toBe("about:srcdoc");
      expect(page.url()).toBe(base);

      // ── un destino de fuera: lo pide, no lo abre él ──────────────────────
      //
      // El lienzo corre con sandbox="allow-scripts" y SIN allow-popups, así que
      // un window.open desde dentro lo bloquea el navegador — el enlace no haría
      // nada y no habría ni un error en consola. La primera versión de esto lo
      // abría desde dentro; lo cazó esta prueba antes de salir.
      await pulsar("fuera");
      const fuera = (await page.evaluate(
        "window.__recibidos.filter(function(m){return m && m.type === 'openlen:abrir-fuera';})",
      )) as Array<{ url: string }>;
      expect(fuera.at(-1)?.url).toContain("instagram.com/x");
      expect(frame.url()).toBe("about:srcdoc");

      // ── LA PORTADA Y ADEMÁS SU SECCIÓN: '/#artistas' ────────────────────
      //
      // Es lo que lleva el menú heredado de una subpágina: sus anclas apuntan a
      // secciones de la PORTADA, que ahí dentro no existen. Tienen que viajar
      // las dos cosas juntas —la ruta y el ancla— o el padre cambia de página y
      // deja al visitante arriba del todo.
      await pulsar("portada-seccion");
      const conSeccion = (await recibidos()).at(-1) as
        | { slug: string; ancla?: string }
        | undefined;
      expect(conSeccion?.slug).toBe("");
      expect(conSeccion?.ancla, "el ancla se perdió por el camino").toBe("artistas");
      expect(frame.url()).toBe("about:srcdoc");

      // ── UN ANCLA DE ESTA MISMA PÁGINA ───────────────────────────────────
      //
      // La primera versión la dejaba pasar «porque el navegador ya hace lo
      // correcto». NO lo hace: sin URL base, '#precios' se resuelve contra el
      // PADRE y el iframe se va a http://127.0.0.1:PUERTO/#precios — fuera del
      // documento. Lo cazó esta prueba, y es peor que el fallo de las rutas
      // porque CASI TODAS las páginas generadas navegan con anclas.
      const antes = (await recibidos()).length;
      await pulsar("ancla");
      expect((await recibidos()).length, "el ancla no debe pedir cambio de página").toBe(antes);
      expect(frame.url(), "el ancla se llevó el lienzo fuera del documento").toBe(
        "about:srcdoc",
      );
      // Y desplazó de verdad hasta la sección. `behavior: smooth` ANIMA, así
      // que se espera a que pare — leerlo a los 60 ms daba 78 px de una
      // animación a medio camino y parecía que no funcionaba.
      let y = 0;
      for (let i = 0; i < 40; i++) {
        y = (await frame.evaluate("window.scrollY")) as number;
        if (y > 500) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(y, "el ancla no desplazó a su sección").toBeGreaterThan(500);

      // ── y `mailto:` tampoco pide nada ni mueve el lienzo ────────────────
      await pulsar("correo");
      expect((await recibidos()).length).toBe(antes);
      expect(frame.url()).toBe("about:srcdoc");
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 90_000);
});
