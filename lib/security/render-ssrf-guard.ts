// SSRF guard for headless-Chrome renders of UNTRUSTED HTML.
//
// When we page.setContent(userHtml) on the box, Chrome fetches every absolute
// subresource the HTML references (<img>, <script>, <link>, CSS url(), fetch,
// <iframe>, …) with the server's full network stack. Without a guard a tenant
// could point those at the box's own loopback Next app (127.0.0.1:3000), the
// private LAN, or the cloud-metadata endpoint (169.254.169.254 on Hetzner) —
// a classic blind-SSRF / internal-probe surface.
//
// The scrape path (lib/style-match/scrape) already validates its NAVIGATION
// target with the same private-range logic, but setContent has no navigation
// URL — the danger is the subresources. So we intercept requests and abort any
// whose host is loopback / link-local / RFC-1918 / otherwise internal. Public
// asset hosts (Tailwind CDN, Google Fonts, R2) resolve to public IPs and pass.
//
// Used by lib/projects/thumbnail.ts (card thumbnails of user pages) and
// lib/ai/inline-image.ts (vision-critic reference shots of generated HTML).

import dns from "node:dns/promises";
import type { Page, Target } from "puppeteer";
import { ipInPrivateRange } from "@/lib/style-match/scrape/validate-url";
import { localResponseFor } from "@/lib/ai/origen-de-medida";

/**
 * SIN SERVICE WORKERS en el Chromium del servidor (pieza 9 de Len 2.5): como un
 * navegador que no los tiene. El código que comprueba `'serviceWorker' in
 * navigator` —el de casi todo el mundo— no lo intenta y no hay error que
 * confunda a los ojos; el modo sin internet no se puede comprobar aquí, y el
 * manual de Len lo dice. Un service worker que sí arrancara aquí guardaría su
 * caché en un navegador que se reutiliza entre medidas.
 */
export const SIN_SERVICE_WORKERS = "try{delete Navigator.prototype.serviceWorker}catch(e){}";

// Schemes that never hit the network in a way that can reach internal hosts.
const ALLOWED_NON_HTTP_SCHEMES = new Set(["data:", "blob:", "about:"]);

const LITERAL_IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** True when a subresource host must be blocked. Fail-closed: anything we
 *  can't resolve, or that looks internal, is blocked. */
async function hostIsBlocked(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  // Bare hostnames (no dot) — "localhost", "metadata", internal service names —
  // and the explicit internal suffixes are never legitimate public assets.
  if (
    !h ||
    h === "localhost" ||
    h === "0.0.0.0" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    !h.includes(".")
  ) {
    return true;
  }
  if (LITERAL_IPV4.test(h)) return ipInPrivateRange(h);
  // IPv6 literals contain ":" (and no dot already returned above) — block them
  // conservatively rather than parse every private v6 range.
  if (h.includes(":")) return true;
  try {
    const { address } = await dns.lookup(h, { family: 4 });
    return ipInPrivateRange(address);
  } catch {
    return true;
  }
}

/**
 * LAS VENTANAS NUEVAS NO SALEN (2026-10-04).
 *
 * La interceptación de abajo es de ESTA página. Una ventana que la página abre
 * —`window.open`, un enlace o un formulario con `target="_blank"`— es OTRO
 * target, sin interceptación y con la red del servidor entera: SSRF al
 * loopback, a la LAN o a los metadatos de la nube. Medido con un servidor en
 * 127.0.0.1: las dos puertas llegaban (`render-ssrf-guard.browser.test.ts`).
 * El transformador de ingestión lo cerraba en su propio navegador; al
 * retirarlo, el JavaScript pegado pasó a correr aquí (miniatura, medición,
 * comprobaciones al publicar), y lo encontró el revisor de publicación.
 *
 * Tres capas, porque ninguna basta sola (medido):
 *   1. `BLOQUEO_DE_VENTANAS`, en el documento actual Y en los nuevos: anula
 *      `window.open` y el `click`/`submit`/`dispatchEvent` programáticos de un
 *      enlace o formulario con destino fuera. Va a los PROTOTIPOS porque
 *      `setContent` de Puppeteer hace `document.open()`, que borra los oyentes
 *      del documento pero no toca el reino; y al documento ACTUAL porque la
 *      guarda se instala con `about:blank` ya cargado, donde
 *      `evaluateOnNewDocument` no llega.
 *   2. `SIN_VENTANAS_NUEVAS` en el `launch`: Puppeteer pasa
 *      `--disable-popup-blocking` por defecto, y sin el bloqueador de Chromium
 *      cualquier script abre ventanas sin que nadie pulse nada.
 *   3. De respaldo, la pestaña que se cuela se cierra. Llega TARDE para su
 *      primera petición (medido), así que no es la defensa: sólo acota.
 *
 * Lo que NO cubre: un clic DE VERDAD (con gesto de usuario) en un enlace
 * `target="_blank"` dentro de una visita (`use_page` intercepta los suyos
 * con su preludio), y `--block-new-web-contents`, que en el headless nuevo no
 * hace nada (medido).
 */
export const BLOQUEO_DE_VENTANAS = `(function () {
  if (window.__olSinVentanas) return;
  window.__olSinVentanas = true;
  // Sólo si sigue siendo el NATIVO: quien mide puede haber puesto antes el suyo,
  // que apunta a dónde manda la página (los graders de Len-Bench, el preludio de
  // use_page) y tampoco abre nada. Una página no se adelanta a esto: corre
  // antes que sus scripts.
  try {
    if (/\\[native code\\]/.test(Function.prototype.toString.call(window.open))) {
      window.open = function () { return null; };
    }
  } catch (e) {}
  function fuera(t) { t = String(t || "").toLowerCase(); return t !== "" && t !== "_self" && t !== "_parent" && t !== "_top"; }
  function base() { var b = document.querySelector("base[target]"); return b ? b.getAttribute("target") : ""; }
  function abre(el, extra) {
    if (!el || !el.getAttribute) return false;
    var enlace = el.matches && el.matches("a[href], area[href]");
    if (!enlace && el.tagName !== "FORM") return false;
    return fuera(extra || el.getAttribute("target") || base());
  }
  function envia(b) {
    return !!(b && b.form && (b.type === "submit" || b.type === "image") && abre(b.form, b.getAttribute("formtarget")));
  }
  var click = HTMLElement.prototype.click;
  HTMLElement.prototype.click = function () {
    if (abre(this.closest ? this.closest("a[href], area[href]") : null) || envia(this)) return;
    return click.apply(this, arguments);
  };
  var submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function () { if (abre(this)) return; return submit.apply(this, arguments); };
  var requestSubmit = HTMLFormElement.prototype.requestSubmit;
  if (requestSubmit) HTMLFormElement.prototype.requestSubmit = function (b) {
    if (abre(this, b && b.getAttribute ? b.getAttribute("formtarget") : "")) return;
    return requestSubmit.apply(this, arguments);
  };
  var despachar = EventTarget.prototype.dispatchEvent;
  EventTarget.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === "click" && this.closest && (abre(this.closest("a[href], area[href]")) || envia(this))) return false;
    return despachar.apply(this, arguments);
  };
})();`;

/** Para el `launch` de todo navegador que pinte HTML ajeno con esta guarda:
 *  vuelve a encender el bloqueador de ventanas de Chromium, que Puppeteer
 *  apaga por defecto (capa 2 de arriba). */
export const SIN_VENTANAS_NUEVAS: { ignoreDefaultArgs: string[] } = {
  ignoreDefaultArgs: ["--disable-popup-blocking"],
};

/** Install request interception on `page` that blocks subresource fetches to
 *  internal/loopback/link-local hosts. Call BEFORE setContent. Safe for public
 *  CDN/font/asset fetches — they resolve to public IPs and continue.
 *
 *  `allowOrigins` punches exact `host[:port]` holes through the block — used
 *  by flight-check, whose audit target is its own ephemeral 127.0.0.1 server
 *  (navigation + /assets fetches must pass while everything else internal
 *  stays blocked). */
export async function installSubresourceSsrfGuard(
  page: Page,
  opts?: {
    allowOrigins?: string[];
    /**
     * SE AVISA DE LO QUE SE BLOQUEA, y no es telemetría: es un hecho que quien
     * juzga la página NECESITA.
     *
     * Sin esto, un `<img>` que este guardia corta deja un hueco en la captura,
     * el modelo con visión lo lee como «imagen rota» y el Agente lo arregla
     * BORRÁNDOLA. Medido el 2026-08-27: Jesús adjuntó una foto, el Agente la
     * colocó bien, y en el turno siguiente se la quitó explicándole que su URL
     * «sólo existe en tu máquina» — cuando el hueco lo habíamos hecho nosotros.
     *
     * En dev toda subida propia sale con URL de `localhost` (no hay R2), así
     * que este guardia —que hace bien su trabajo: una página hostil podría
     * apuntar un <img> a la app del propio servidor— convierte cada imagen que
     * el usuario sube en una «rota» a ojos del verificador.
     *
     * El hecho lo tiene el guardia. Tirarlo es lo que deja al juicio inventar.
     */
    onBlocked?: (url: string) => void;
    /**
     * LA PÁGINA NO SE VA. Con esto, una navegación del marco principal fuera de
     * `allowOrigins` —un `location.href = "https://wa.me/…"`, un `tel:`— se
     * corta y se avisa con su dirección, en vez de salir a la red.
     *
     * Lo necesita `use_page` (`lib/agent/usar-pagina.ts`), que usa la página
     * como un visitante: un botón de WhatsApp no puede abrir WhatsApp de
     * verdad, y a dónde mandaba es justo el dato que Len tiene que ver. Sin la
     * opción, todo sigue como antes.
     */
    alSalir?: (url: string) => void;
  },
): Promise<void> {
  const allowedOrigins = new Set(
    (opts?.allowOrigins ?? []).map((o) => o.toLowerCase()),
  );
  const saliendo = (url: string, req: { isNavigationRequest(): boolean; frame(): unknown }): boolean => {
    if (!opts?.alSalir || !req.isNavigationRequest() || req.frame() !== page.mainFrame()) return false;
    try {
      const u = new URL(url);
      if ((u.protocol === "http:" || u.protocol === "https:") && allowedOrigins.has(u.host.toLowerCase())) return false;
    } catch {
      /* una dirección que no se deja leer tampoco sale */
    }
    return true;
  };
  const avisar = (url: string) => {
    try {
      opts?.onBlocked?.(url);
    } catch {
      /* quien escucha no puede tumbar el guardia */
    }
  };
  // Las ventanas nuevas (ver BLOQUEO_DE_VENTANAS): capas 1 y 3.
  await page.evaluateOnNewDocument(BLOQUEO_DE_VENTANAS);
  await page.evaluateOnNewDocument(SIN_SERVICE_WORKERS);
  await page.evaluate(BLOQUEO_DE_VENTANAS).catch(() => undefined);
  const propia = page.target();
  const navegador = page.browser();
  const cerrarSiEsSuya = (t: Target) => {
    if (t.opener() !== propia) return;
    void t
      .page()
      .then((p) => p?.close())
      .catch(() => undefined);
  };
  navegador.on("targetcreated", cerrarSiEsSuya);
  page.once("close", () => navegador.off("targetcreated", cerrarSiEsSuya));

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    // The handler MUST resolve every request exactly once (continue/abort) or
    // the page hangs until the navigation timeout. Wrapped so a throw still
    // aborts rather than dangling.
    void (async () => {
      try {
        const url = req.url();
        if (saliendo(url, req)) {
          try {
            opts?.alSalir?.(url);
          } catch {
            /* quien escucha no puede tumbar el guardia */
          }
          await req.abort("blockedbyclient");
          return;
        }
        const scheme = url.slice(0, url.indexOf(":") + 1).toLowerCase();
        if (ALLOWED_NON_HTTP_SCHEMES.has(scheme)) {
          await req.continue();
          return;
        }
        if (scheme !== "http:" && scheme !== "https:") {
          avisar(url);
          await req.abort("blockedbyclient");
          return;
        }
        const { hostname, host } = new URL(url);
        if (allowedOrigins.has(host.toLowerCase())) {
          // LA CARPETA (pieza 9 de Len 2.5): un fichero de la carpeta del
          // documento que se mide se contesta desde memoria, sin red; lo
          // demás del origen permitido sigue como siempre.
          const local = localResponseFor(url, req.frame()?.url() ?? page.url());
          if (local) {
            await req.respond({ status: local.status, contentType: local.contentType, body: local.body });
            return;
          }
          await req.continue();
          return;
        }
        if (await hostIsBlocked(hostname)) {
          avisar(url);
          await req.abort("blockedbyclient");
          return;
        }
        await req.continue();
      } catch {
        // Already-handled / navigation race / parse failure — fail closed.
        try {
          avisar(req.url());
          await req.abort("blockedbyclient");
        } catch {
          /* request already resolved elsewhere */
        }
      }
    })();
  });
}
