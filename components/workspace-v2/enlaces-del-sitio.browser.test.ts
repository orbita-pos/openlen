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
import { injectInlineEdit } from "./use-inline-edit";

// 🔴 LOS DOS SCRIPTS, COMO EN EL TALLER. Esta prueba montaba SÓLO
// `use-page-links` — y por eso salía verde mientras en producción el clic moría:
// `use-inline-edit` engancha su propio manejador en fase de CAPTURA, o sea
// ANTES, y cancelaba el enlace antes de que el otro pudiera mandarlo al padre.
// Jesús lo reportó como «los links tipo whatsapp no los abre el editor».
//
// El taller inyecta los cinco scripts SIEMPRE, en cualquier modo (ver el
// comentario de `preview-area.tsx` sobre el patrón de iframe persistente), así
// que una prueba con uno solo no mide el lienzo que existe.
const PAGINA = injectInlineEdit(
  injectPageLinks(
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
    '<a id="telefono" href="tel:+525512345678">Teléfono</a>' +
    '<a id="whats" href="whatsapp://send?phone=525512345678">WhatsApp</a>' +
    "</nav>" +
    '<section id="precios" style="margin-top:2000px;height:200px">Precios</section>' +
      "</body></html>",
  ),
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
      // 🔴 EL MISMO SANDBOX QUE EL TALLER, Y ESTO NO ES DECORACIÓN.
      //
      // Sin el atributo, este iframe es un documento cualquiera y el navegador
      // le deja hacer cosas que en `preview-area.tsx` NO puede hacer: la
      // prueba medía un navegador que no existe. Con `sandbox="allow-scripts"`
      // —origen opaco, sin allow-popups y sin allow-top-navigation— Chromium
      // RECHAZA cualquier navegación a un protocolo externo, y lo dice sólo en
      // la consola DE DENTRO: el usuario no la ve, y el padre tampoco puede
      // leerla porque el origen es opaco.
      //
      // Eso era el bug #2 de Jesús: pulsar el teléfono o el WhatsApp de su
      // propia página y que no pasara absolutamente nada.
      '<iframe id="lienzo" sandbox="allow-scripts" style="width:600px;height:400px"></iframe>' +
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
      // La consola DE DENTRO del lienzo. Es donde Chromium deja el único rastro
      // de un protocolo externo rechazado por el sandbox, y por eso el fallo
      // era mudo: ni el usuario ni el padre pueden leerla.
      const consola: string[] = [];
      page.on("console", (m) => consola.push(m.text()));
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

      // 🔴 Y QUE EL AVISO SALGA UNA SOLA VEZ, Y CON LOS DOS SCRIPTS MONTADOS.
      // Cancelar el clic es CORRECTO —lo abre el padre, ver use-page-links— así
      // que lo que hay que vigilar no es `defaultPrevented` sino que el mensaje
      // llegue estando el editor en medio. Esta prueba montaba SÓLO
      // use-page-links, y por eso no podía ver nada de lo que pasa cuando los
      // dos manejadores compiten por el mismo clic.
      expect(fuera.length, "el aviso no llegó con el editor montado").toBeGreaterThan(0);

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

      // ── LOS ENLACES DE CONTACTO: correo, teléfono y WhatsApp ────────────
      //
      // 🔴 AQUÍ ESTABA EL BUG #2, Y ESTA PRUEBA LO SUJETABA.
      //
      // Decía «y `mailto:` tampoco pide nada ni mueve el lienzo», y daba verde
      // — porque su iframe no llevaba sandbox. Con el sandbox de verdad
      // (`allow-scripts`, sin allow-popups y sin allow-top-navigation) Chromium
      // RECHAZA la navegación a cualquier protocolo externo:
      //
      //   "Navigation to external protocol blocked by sandbox, because it
      //    doesn't contain any of: 'allow-top-navigation-to-custom-protocols',
      //    'allow-top-navigation-by-user-activation', 'allow-top-navigation',
      //    or 'allow-popups'."
      //
      // Y ese aviso sale en la consola DE DENTRO del lienzo: el usuario no la
      // ve, y el padre no puede leerla porque el origen es opaco. Pulsabas el
      // teléfono de tu propia página y no pasaba NADA, sin un solo rastro.
      //
      // Lo mismo que ya se hacía con http(s): el destino sube al padre, que no
      // está en caja. `mailto:` está en 49 de los 292 HTML del corpus y `tel:`
      // en 10 — y la propia caja de «Destino» del inspector convierte un
      // teléfono suelto en `tel:` (ver normalize-href.ts), o sea que el
      // producto FABRICA enlaces que él mismo no sabía abrir.
      const contacto = async (id: string) => {
        const n = ((await page.evaluate(
          "window.__recibidos.filter(function(m){return m && m.type === 'openlen:abrir-fuera';}).length",
        )) as number);
        await pulsar(id);
        const lista = (await page.evaluate(
          "window.__recibidos.filter(function(m){return m && m.type === 'openlen:abrir-fuera';})",
        )) as Array<{ url: string }>;
        expect(lista.length, `${id} no pidió abrirse fuera`).toBe(n + 1);
        return lista.at(-1)!.url;
      };

      expect(await contacto("correo")).toBe("mailto:hola@x.com");
      expect(await contacto("telefono")).toBe("tel:+525512345678");
      expect(await contacto("whats")).toBe("whatsapp://send?phone=525512345678");

      // Y el lienzo sigue donde estaba: pedirlo arriba no es navegar aquí.
      expect(frame.url()).toBe("about:srcdoc");

      // BRAZO DE CONTROL. Si el clic se le hubiera dejado al navegador —que es
      // lo que hacía antes— Chromium habría escrito su rechazo aquí. Que la
      // consola esté limpia es la prueba de que ya no se le deja.
      expect(
        consola.filter((l) => /blocked by sandbox/i.test(l)),
        "el clic se sigue dejando al navegador, y el sandbox lo rechaza",
      ).toEqual([]);
    } finally {
      await browser.close();
      server?.close();
      server = null;
    }
  }, 90_000);
});

// ── Y LA OTRA MITAD: QUÉ HACE EL PADRE CON LO QUE LE SUBE ────────────────────
//
// La prueba de arriba acaba en el buzón: comprueba que el aviso sale del
// lienzo. Eso deja sin medir la mitad donde una equivocación es CARA — el padre
// no está en caja, así que un destino mal clasificado no se queda en nada: se
// lleva el taller por delante, con las ediciones sin guardar dentro.
//
// Aquí corre el módulo DE VERDAD (`abrir-fuera.ts`, compilado con esbuild y
// metido en la página) en el documento del padre, y se mira el efecto real.
describe("el padre abriendo el destino que le sube el lienzo", () => {
  it("entrega el protocolo externo sin moverse, y no confunde abrir con bloquear", async () => {
    // esbuild se compila EN UN PROCESO HIJO, no aquí: dentro de jsdom su
    // invariante `new TextEncoder().encode("") instanceof Uint8Array` es falsa
    // —jsdom trae sus propios globales— y se niega a arrancar.
    const { execFileSync } = await import("node:child_process");
    const guion =
      "const {buildSync}=require('esbuild');" +
      "const r=buildSync({entryPoints:['components/workspace-v2/abrir-fuera.ts']," +
      "bundle:true,format:'iife',globalName:'OL',write:false,platform:'browser'});" +
      "process.stdout.write(r.outputFiles[0].text);";
    const codigo = execFileSync(process.execPath, ["-e", guion], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });

    const PADRE =
      "<!doctype html><html><body>" +
      "<script>__CODIGO__</script>" +
      "<script>window.__resultados = [];" +
      "window.addEventListener('message', function (e) {" +
      "  if (!e.data || e.data.type !== 'openlen:abrir-fuera') return;" +
      "  window.__resultados.push({ url: e.data.url, r: OL.abrirDesdeElTaller(e.data.url) });" +
      "});</script>" +
      '<iframe id="lienzo" sandbox="allow-scripts" style="width:600px;height:400px"></iframe>' +
      "<script>document.getElementById('lienzo').srcdoc = __DOC__;</script>" +
      "</body></html>";

    const srv = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      const literal = JSON.stringify(PAGINA).replace(/<\//g, "<\\/");
      res.end(
        PADRE.replace("__CODIGO__", () => codigo.replace(/<\//g, "<\\/")).replace(
          "__DOC__",
          () => literal,
        ),
      );
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const dir = srv.address();
    if (dir === null || typeof dir === "string") throw new Error("sin puerto");

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      // Hermética: sólo el servidor local sale a la red. Sin esto, el
      // `window.open` de verdad se iría a instagram.com.
      await page.setRequestInterception(true);
      page.on("request", (r) =>
        r.url().startsWith(`http://127.0.0.1:${dir.port}`) ? r.continue() : r.abort(),
      );
      browser.on("targetcreated", async (t) => {
        try {
          const p = await t.page();
          if (p) await p.close();
        } catch {
          /* la pestaña ya se cerró sola */
        }
      });

      const base = `http://127.0.0.1:${dir.port}/`;
      await page.goto(base, { waitUntil: "load", timeout: 20_000 });
      let frame = page.mainFrame();
      for (let i = 0; i < 60 && frame === page.mainFrame(); i++) {
        for (const f of page.frames()) {
          if (f === page.mainFrame()) continue;
          if (await f.evaluate("!!document.getElementById('correo')").catch(() => false)) {
            frame = f;
            break;
          }
        }
        if (frame === page.mainFrame()) await new Promise((r) => setTimeout(r, 100));
      }
      if (frame === page.mainFrame()) throw new Error("el iframe nunca cargó el documento");

      const pulsar = async (id: string) => {
        await frame.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
        await new Promise((r) => setTimeout(r, 200));
        return (await page.evaluate("window.__resultados")) as Array<{ url: string; r: string }>;
      };

      // Correo, teléfono y WhatsApp: se ENTREGAN al sistema.
      expect((await pulsar("correo")).at(-1)).toEqual({ url: "mailto:hola@x.com", r: "entregada" });
      expect((await pulsar("telefono")).at(-1)?.r).toBe("entregada");
      expect((await pulsar("whats")).at(-1)?.r).toBe("entregada");

      // 🔴 Y EL TALLER SIGUE DONDE ESTABA. Entregar un protocolo externo con un
      // ancla del padre no navega — pero un destino sin esquema SÍ lo haría, y
      // por eso la lista rechaza lo que no lleva uno. Esto es lo que mide que
      // esa regla existe de verdad y no sólo en un comentario.
      expect(page.url(), "el taller se fue de viaje con las ediciones dentro").toBe(base);
      expect(
        await page.evaluate("document.querySelectorAll('a').length"),
        "el ancla de entrega se quedó en el documento",
      ).toBe(0);

      // 🔴 UN http(s) SE ABRE, Y NO SE CONFUNDE CON UN BLOQUEO.
      //
      // `window.open` CONSUME la activación transitoria y con `noopener`
      // devuelve null aunque la pestaña se haya abierto. La primera versión de
      // este aviso leía las dos señales DESPUÉS de abrir, así que decía «tu
      // navegador bloqueó la pestaña» en CADA clic externo, con la pestaña
      // abierta delante. Aquí, en un navegador de verdad, tiene que salir
      // "abierta" — con el orden malo saldría "sin-gesto".
      expect((await pulsar("fuera")).at(-1)?.r).toBe("abierta");
    } finally {
      await browser.close();
      srv.close();
    }
  }, 90_000);
});
