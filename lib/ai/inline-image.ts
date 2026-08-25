// Helpers to turn an image into a Gemini `inlineData` part (Quality S2).
//
// The native Gemini streamGenerateContent API (used by @openlen/ai-gateway)
// does NOT fetch remote URLs the way the OpenAI-compatible endpoint does — it
// only accepts base64 `inlineData`. So the reference image is fetched (or
// rendered) here and handed to the gateway as base64.
//
// Both helpers are BEST-EFFORT: any failure (fetch error, oversize, render
// crash) returns null and the caller proceeds text-only. The image is a
// quality boost, never load-bearing.

import type { InlineImage } from "@/lib/ai-gateway";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { PULSAR_CONTROLES } from "@/lib/ai/press-controls";

const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// 4 MB raw cap — full-page template JPGs at q82 run ~100–600 KB; this leaves
// generous headroom while staying well under Gemini's request size limit.
const FETCH_MAX_BYTES = 4 * 1024 * 1024;

// Y UN PLAZO. El cap de arriba no sirve de nada si el servidor de enfrente
// acepta la conexión y no manda nunca el cuerpo: `fetch` no trae timeout por
// omisión, así que la petición se queda colgada — y el Agente hace esto ANTES
// de abrir el SSE, o sea que el usuario ve la nada. La imagen es un extra
// (todo este módulo es best-effort): si no llega en 10s, el turno sigue sin
// ella, que es exactamente lo que pasa hoy si la URL da 404.
const FETCH_TIMEOUT_MS = 10_000;

/** Lee el cuerpo por trozos y CORTA en cuanto pasa del tope, en vez de
 *  materializarlo entero y medirlo después. Un `arrayBuffer()` sobre una
 *  respuesta de 2 GB reserva 2 GB de memoria y sólo entonces descubre que
 *  sobra: el tope existía, pero el daño ya estaba hecho. */
async function leerConTope(
  res: Response,
  maxBytes: number,
): Promise<{ ok: true; buf: Buffer } | { ok: false; bytes: number }> {
  const body = res.body;
  if (!body) {
    // Sin ReadableStream (algún doble de prueba, algún runtime raro): último
    // recurso con el tope aplicado después, que es el comportamiento de antes.
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > maxBytes ? { ok: false, bytes: buf.length } : { ok: true, buf };
  }
  const reader = body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      // Cancelar cierra la conexión: lo que quede al otro lado no se descarga.
      await reader.cancel().catch(() => {});
      return { ok: false, bytes: total };
    }
    trozos.push(value);
  }
  return { ok: true, buf: Buffer.concat(trozos) };
}

function pickImageMime(contentType: string, url: string): string | null {
  const ct = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_MIME.includes(ct)) return ct;
  const u = url.toLowerCase();
  if (u.endsWith(".jpg") || u.endsWith(".jpeg")) return "image/jpeg";
  if (u.endsWith(".png")) return "image/png";
  if (u.endsWith(".webp")) return "image/webp";
  if (u.endsWith(".gif")) return "image/gif";
  return null;
}

/** Fetch an image URL and return it as a base64 inlineData part. Null on any
 *  failure (non-200, non-image, empty, or over the size cap). */
export async function fetchImageAsInlineData(
  url: string,
  opts: {
    maxBytes?: number;
    signal?: AbortSignal;
    redirect?: RequestRedirect;
    timeoutMs?: number;
  } = {},
): Promise<InlineImage | null> {
  const maxBytes = opts.maxBytes ?? FETCH_MAX_BYTES;
  // Un solo controlador: el plazo propio y la señal de quien llama abortan la
  // MISMA petición. Sin esto, la señal del llamador era un parámetro que nadie
  // pasaba y el plazo no existía.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? FETCH_TIMEOUT_MS);
  const forward = () => abort.abort();
  opts.signal?.addEventListener("abort", forward, { once: true });
  if (opts.signal?.aborted) abort.abort();
  try {
    // redirect:"error" is for USER-SUPPLIED urls (agent attached images): the
    // caller validates the host first, and following a redirect would let a
    // public host bounce the fetch to an internal one past that check.
    const res = await fetch(url, {
      signal: abort.signal,
      cache: "no-store",
      redirect: opts.redirect ?? "follow",
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[inline-image] fetch ${url} → ${res.status}`);
      return null;
    }
    const mimeType = pickImageMime(res.headers.get("content-type") ?? "", url);
    if (!mimeType) {
      // eslint-disable-next-line no-console
      console.warn(`[inline-image] ${url} is not a supported image type`);
      return null;
    }
    // Si el servidor declara el tamaño y ya se pasa, se rechaza SIN descargar
    // un solo byte del cuerpo. Es la mitad barata del tope; la otra mitad
    // (`leerConTope`) cubre a quien no declara nada o miente.
    const declarado = Number(res.headers.get("content-length"));
    if (Number.isFinite(declarado) && declarado > maxBytes) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inline-image] ${url} declara ${declarado}B > ${maxBytes} — no se descarga`,
      );
      return null;
    }
    const leido = await leerConTope(res, maxBytes);
    if (!leido.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[inline-image] ${url} pasó de ${maxBytes}B (${leido.bytes}B leídos) — cancelado`,
      );
      return null;
    }
    if (leido.buf.length === 0) {
      // eslint-disable-next-line no-console
      console.warn(`[inline-image] ${url} llegó vacío — skipping`);
      return null;
    }
    return { mimeType, dataBase64: leido.buf.toString("base64") };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[inline-image] fetch failed for ${url}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", forward);
  }
}

/** Render an HTML document to a full-page JPEG and return it as an inlineData
 *  part — used by the Chat tab to show the model the CURRENT page as visual
 *  context. Best-effort: returns null on render failure or if it exceeds the
 *  size cap. Puppeteer is dynamic-imported so it stays out of the route's
 *  static bundle.
 *
 *  NOTE: this spawns headless Chromium per call, so the ai-design caller
 *  leaves it OFF by default — opt in with OPENLEN_AIDESIGN_PAGE_REFERENCE=1.
 *  (The /api/generate reference path doesn't use this — it fetches a
 *  pre-rendered template screenshot.) */
/**
 * Pulsa los controles de la página y devuelve cuántos.
 *
 * VA COMO CADENA, no como función. `page.evaluate(() => …)` pasa por
 * esbuild/tsx, que inyecta el ayudante `__name` para conservar los nombres de
 * las funciones — y `__name` no existe dentro del navegador, así que la
 * evaluación revienta con un error que no tiene nada que ver con la página. Ya
 * nos costó una sesión ([[render-measured-contrast]]). La cadena no pasa por
 * ningún transformador.
 *
 * SE PULSA POR ETIQUETA, no por quién tenga un `click` atado. El primer intento
 * envolvía `addEventListener` desde `evaluateOnNewDocument` para marcar
 * exactamente lo que el modelo cableaba — y MEDIDO: no corría nunca.
 * `page.setContent` usa `document.write`, que no crea un documento nuevo, así
 * que el enganche no llega a instalarse y el marcado salía a cero. Pulsar lo
 * que un visitante pulsaría es además lo honesto: si un botón no tiene nada
 * atado, no pasa nada; si lo tiene y revienta, se entera.
 *
 * Tope de ocho: con eso ya se sabe si los controles viven, y cada clic puede
 * disparar trabajo arbitrario del modelo.
 */
const PULSAR = PULSAR_CONTROLES;

export async function renderHtmlToInlineImage(
  html: string,
  opts: {
    maxBytes?: number;
    /** Se llama con lo que la página tiró al cargar (excepciones + errores de
     *  consola), deduplicado. Sin esto el render se comporta EXACTAMENTE igual
     *  que antes: nadie paga nada por una señal que no pidió. */
    onErrors?: (errores: readonly string[]) => void;
    /** Pulsar los controles que el JavaScript de la página cableó, DESPUÉS de
     *  la captura, y recoger lo que revienten. Apagado por omisión: cuesta unos
     *  cientos de ms y no todo render lo quiere. */
    pressButtons?: boolean;
    /** El programa de comprobación de comportamiento (lib/agent/behavior-spec)
     *  a ejecutar DESPUÉS de la captura, en este mismo navegador. Devuelve lo
     *  que el navegador respondió, sin interpretar.
     *
     *  Va en vez de `pressButtons`, no además: pulsar a ciegas y luego seguir
     *  un guion dejaría la página en un estado que el guion no espera — y una
     *  prueba sobre un estado desconocido no comprueba nada. */
    behaviorProgram?: string;
    onBehaviorResult?: (bruto: unknown) => void;
  } = {},
): Promise<InlineImage | null> {
  // Spec: inline base64 when small. 1 MB JPEG of a full page is plenty of
  // visual fidelity for a reference and keeps the request lean.
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const errores: string[] = [];
  try {
    const puppeteer = (await import("puppeteer")).default;
    const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || undefined;
    // Override HOME for the Chrome subprocess so its XDG bootstrap (mimeapps,
    // crashpad database, default config) lands somewhere writable. The
    // openlen-app systemd unit hardens /home/<service-user> as read-only via
    // ProtectHome — without this, Chrome crashes at launch with
    // "cannot create directory '~/.local': Read-only file system".
    // /tmp is always writable; the env override only affects the spawned
    // Chrome process, not the Node parent.
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
      env: {
        ...process.env,
        HOME: "/tmp",
      },
    });
    try {
      const page = await browser.newPage();
      // LO QUE LA PAGINA GRITA AL CARGAR. El modelo escribe JavaScript y nunca
      // sabia si explotaba: MEDIDO el 2026-08-22, un juego que el modelo
      // escribio tenia un TypeError que solo aparecia CARGANDO la pagina — la
      // captura salia perfecta y el juego estaba muerto.
      //
      // Los ojos ya lanzan Chrome para la captura, asi que esto no cuesta un
      // arranque mas. Es la version barata de «apretar el boton»: no interactua
      // con la pagina, pero si el script muere al cargar, se entera.
      page.on("pageerror", (e) => {
        errores.push(String(e instanceof Error ? e.message : e).slice(0, 300));
      });
      page.on("console", (m) => {
        if (m.type() === "error") errores.push(`consola: ${m.text().slice(0, 300)}`);
      });
      // Un `confirm()` o un `alert()` dentro de un manejador deja la página
      // colgada esperando a nadie. Se descartan antes de que puedan aparecer.
      page.on("dialog", (d) => {
        void d.dismiss().catch(() => {});
      });
      // Block subresource fetches to internal/loopback/metadata hosts — this
      // HTML is model-generated and not fully trusted. (SSRF guard.)
      await installSubresourceSsrfGuard(page);
      await page.setViewport({ width: 1280, height: 720 });
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      // Tailwind CDN + Google Fonts apply async after `load`; wait for fonts
      // and give the CDN a beat so the capture isn't the unstyled FOUT state.
      await page.evaluate(() =>
        "fonts" in document ? document.fonts.ready : Promise.resolve(),
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
      const shot = (await page.screenshot({
        type: "jpeg",
        quality: 75,
        fullPage: true,
      })) as Buffer;
      if (shot.length === 0 || shot.length > maxBytes) {
        // La foto se descarta, los GRITOS no. Que la captura salga grande no
        // borra que el JavaScript de la página reventara al cargarla: sin esta
        // línea, una página rota y pesada se iba con la consola limpia.
        if (errores.length > 0) opts.onErrors?.([...new Set(errores)]);
        // eslint-disable-next-line no-console
        console.warn(
          `[inline-image] rendered page ${shot.length}B exceeds cap ${maxBytes} — skipping reference`,
        );
        return null;
      }
      // DESPUÉS de la captura, nunca antes: pulsar puede mover el DOM, y la
      // foto tiene que ser de la página tal como llega el visitante.
      //
      // POR QUÉ EXISTE. Recoger `pageerror` al cargar ve el script que muere en
      // el arranque, y nada más. Un juego que se rompe en la SEGUNDA jugada, o
      // un carrito cuyo botón lanza al pulsarlo, cargan limpios y salen
      // perfectos en la foto. Sin esto, los ojos daban por sana una página que
      // no funciona en cuanto alguien la toca.
      //
      // El GUION del modelo tiene prioridad sobre pulsar a ciegas: si declaró
      // qué debe pasar, se comprueba eso, sobre una página en el estado que él
      // espera. Pulsar antes la dejaría en un estado que su guion no previó.
      if (opts.behaviorProgram) {
        try {
          const bruto = await page.evaluate(opts.behaviorProgram);
          // Un manejador que lanza se reporta de forma asíncrona; sin esta
          // espera el navegador se cierra antes de que llegue el aviso.
          await new Promise((resolve) => setTimeout(resolve, 150));
          opts.onBehaviorResult?.(bruto);
        } catch (err) {
          // FAIL-OPEN: una prueba que no se pudo correr NO acusa a la página.
          // No medir no es lo mismo que medir mal.
          // eslint-disable-next-line no-console
          console.warn("[inline-image] la prueba de comportamiento no corrió:", err);
        }
      } else if (opts.pressButtons) {
        try {
          const pulsados = await page.evaluate(PULSAR);
          if (typeof pulsados === "number" && pulsados > 0) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        } catch (err) {
          // Pulsar es un extra. Que falle no puede costar la captura, que es
          // para lo que se lanzó Chrome.
          // eslint-disable-next-line no-console
          console.warn("[inline-image] no se pudieron pulsar los controles:", err);
        }
      }
      if (errores.length > 0) opts.onErrors?.([...new Set(errores)]);
      return { mimeType: "image/jpeg", dataBase64: Buffer.from(shot).toString("base64") };
    } finally {
      await browser.close();
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[inline-image] renderHtmlToInlineImage failed:", err);
    return null;
  }
}
