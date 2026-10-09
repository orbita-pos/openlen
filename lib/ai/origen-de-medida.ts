// EL ORIGEN EN EL QUE SE MIDE UNA PÁGINA.
//
// EL PROBLEMA, medido el 2026-08-26 en la primera página que se generó con el
// JavaScript ya libre:
//
//   SecurityError: Failed to read the 'localStorage' property from 'Window':
//   Access is denied for this document.
//
// El modelo hizo exactamente lo que se le pidió —un carrito que sobrevive a
// recargar la página— y nosotros lo medimos como ROTO. `page.setContent(html)`
// carga el documento en `about:blank`, y un documento de `about:blank` tiene
// ORIGEN OPACO: `localStorage` no es que esté vacío, es que LANZA. Lo mismo
// `sessionStorage`, `indexedDB`, las cookies y todo lo que exija un contexto
// seguro.
//
// El coste no era teórico: esa medida contaba como rotura, disparaba una
// reescritura completa, tiraba la página que el usuario ya había visto, le
// cobraba un crédito más — y la segunda versión traía un fallo de verdad que
// se entregó igual.
//
// LA REGLA: se mide en las MISMAS condiciones en las que se publica. La página
// publicada se sirve por HTTP desde un dominio de verdad, así que aquí se
// sirve por HTTP desde `127.0.0.1`, que Chromium además trata como contexto
// seguro (igual que `localhost`) sin necesidad de un certificado.
//
// POR QUÉ UN SERVIDOR PARA TODO EL PROCESO Y NO UNO POR RENDER: el pool de
// renderizado crea sus navegadores por adelantado y REUTILIZA sus páginas, y
// el guardia SSRF (render-ssrf-guard.ts) fija su lista de orígenes permitidos
// en el momento de instalarse, una sola vez por página. Un puerto distinto en
// cada render dejaría fuera al siguiente. Con un puerto estable el guardia se
// instala una vez y sigue valiendo; lo que cambia por render es la RUTA, que
// lleva un identificador único para que dos renders a la vez no se pisen.
//
// Es el mismo camino que ya usa flight-check para auditar una release: servir
// desde un efímero en 127.0.0.1 y abrir ese URL con el guardia apuntando a él.

import { createServer, type IncomingMessage, type Server } from "node:http";

import { allowEgressOrigin } from "@/lib/security/egress-proxy";
import { randomUUID } from "node:crypto";
import { contentTypeFor, isPublishableFolderPath } from "@/lib/agent/ficheros/folder";

export interface DocumentoServido {
  /** El URL que hay que abrir en el navegador. */
  readonly url: string;
  /** Deja de servirlo. Llamar SIEMPRE al terminar el render, o el documento
   *  se queda en memoria hasta que muera el proceso. */
  soltar(): void;
}

// ⚰️ `OpcionesDePublicacion` (el subdominio y los bytes ya usados) sólo servían
// para que el sustituto de `/api/d` juzgara sus rutas; se retiró el 2026-10-04 con los almacenes `data-ol-stores`.

/** LA CARPETA (pieza 9 de Len 2.5): lo que acompaña a un documento. */
export interface OpcionesDelDocumento {
  /** Los ficheros del proyecto (`/js/app.js` → contenido). Sólo se contestan
   *  los que se publican (`isPublishableFolderPath`), y desde memoria: ver
   *  `localResponseFor`. */
  readonly files?: Readonly<Record<string, string>>;
  /** UNA APP (plan 02): el sourcemap de cada fichero servido que lo tiene (el
   *  paquete de la entrada). No se le sirve al navegador: con él se traducen
   *  las trazas de sus errores (`traductorDeMapas`). */
  readonly sourceMaps?: Readonly<Record<string, string>>;
  /** La página que es (`null` o ausente = la home). El documento se sirve en
   *  `/<id>/<pagina>/` para que lo relativo se resuelva desde su carpeta, como
   *  en la publicada (`/<pagina>/`). */
  readonly pagina?: string | null;
  /** UNA APP: la pantalla que se abre, como su ruta de hash (`#/ventas`). Va
   *  detrás del URL del documento; el servidor nunca la ve. */
  readonly hash?: string;
  /** UNA APP (H12 de la spec local 2026-10-07-apps): tras cargar, esperar a que
   *  la red se calme. Una app pide sus datos DESPUÉS del `load`, y medirla en
   *  ese instante es medir su «Cargando…». */
  readonly esperarALaRed?: boolean;
  /** Lo que sirve LA PLATAFORMA a este documento bajo `/openlen/` (las pruebas
   *  empaquetadas de una app, plan 04): no son de la carpeta del proyecto, así
   *  que no pasan su filtro de lo publicable — se aceptan sólo bajo `/openlen/`. */
  readonly platformFiles?: Readonly<Record<string, string>>;
}

/** Cuánto sin peticiones abiertas es «la red se calmó», y el tope de la
 *  espera: una app que sondea cada segundo no puede colgar la medida. */
export const RED_CALMADA_MS = 500;
export const ESPERA_A_LA_RED_MS = 5_000;

/** Lo mínimo para esperar a la red. Estructural: la `Page` de Puppeteer encaja,
 *  y un doble de prueba que no lo trae simplemente no espera. */
export interface ConEsperaDeRed {
  waitForNetworkIdle?(options?: { idleTime?: number; timeout?: number }): Promise<unknown>;
}

/**
 * Espera a que la red se calme, con tope, si la vista lo pide. Nunca lanza: si
 * se acaba el tope, se mide lo que haya —que es lo que vería un visitante
 * impaciente—, no se deja de medir.
 */
export async function esperarALaRed(page: ConEsperaDeRed, opciones: Pick<OpcionesDelDocumento, "esperarALaRed"> | undefined): Promise<void> {
  if (!opciones?.esperarALaRed || !page.waitForNetworkIdle) return;
  await page.waitForNetworkIdle({ idleTime: RED_CALMADA_MS, timeout: ESPERA_A_LA_RED_MS }).catch(() => undefined);
}

export interface OrigenDeMedida {
  /** `host:puerto`, tal y como lo quiere `allowOrigins` del guardia SSRF. */
  readonly origin: string;
  publicar(html: string, opciones?: OpcionesDelDocumento): DocumentoServido;
}

/** Los documentos vivos ahora mismo, por identificador de ruta. */
const documentos = new Map<string, string>();
/** Los ficheros de la carpeta de cada documento vivo. */
const ficherosPorDocumento = new Map<string, ReadonlyMap<string, string>>();
/** El `host:puerto` del servidor, una vez arrancado. */
let origenVivo: string | null = null;

/**
 * LOS OJOS DE LEN CARGAN LA CARPETA (pieza 9 de Len 2.5). Lo que el guardia
 * SSRF contesta en memoria (`req.respond`) cuando el documento pide un fichero
 * de su carpeta: `/js/app.js` desde la raíz, o `js/app.js` relativo. Sin esto
 * una página con `<script src="/js/app.js">` se mediría rota aquí y funcionaría
 * publicada. Por qué en memoria y no en el servidor: varios documentos
 * comparten este origen a la vez, y una ruta desde la raíz no dice de cuál es;
 * el guardia sí lo sabe, por la página que la pide (`documentUrl`).
 *
 * `null` = no es de aquí: la petición sigue su camino (y da 404, como hoy).
 */
export function localResponseFor(
  requestUrl: string,
  documentUrl: string | null,
): { status: 200; contentType: string; body: string } | null {
  if (!origenVivo || !documentUrl) return null;
  let pedida: URL;
  let doc: URL;
  try {
    pedida = new URL(requestUrl);
    doc = new URL(documentUrl);
  } catch {
    return null;
  }
  if (pedida.host !== origenVivo || doc.host !== origenVivo) return null;
  const id = doc.pathname.split("/")[1] ?? "";
  const files = ficherosPorDocumento.get(id);
  if (!files) return null;
  let ruta: string;
  try {
    ruta = decodeURIComponent(pedida.pathname);
  } catch {
    return null;
  }
  // Lo relativo al documento llega con su id delante: se quita, y queda la
  // ruta que tendría en la publicada.
  if (ruta.startsWith(`/${id}/`)) ruta = ruta.slice(id.length + 1);
  const body = files.get(ruta);
  return body === undefined ? null : { status: 200, contentType: contentTypeFor(ruta), body };
}

function crear(): Promise<OrigenDeMedida> {
  const server: Server = createServer((req, res) => {
    // ⚰️ Aquí se contestaba `/api/d` con el sustituto del almacén de la página;
    // se retiró el 2026-10-04 con los almacenes `data-ol-stores`.
    // `/<id>/` y nada más. Cualquier otra ruta es un subrecurso relativo que
    // el documento pidió y que aquí no existe: 404 y punto — el guardia SSRF
    // ya decide qué subrecursos ABSOLUTOS pueden salir a la red.
    const ruta = (req.url ?? "").split("?")[0]!;
    // El favicon lo pide el navegador SOLO, por servir esto sobre HTTP. Es un
    // artefacto de la medición, no algo que el documento haya pedido: un 404
    // aquí acabaría en la consola y de ahí en la lista de defectos del modelo.
    if (ruta === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    // El documento vive en `/<id>/` o, si es la página de un slug,
    // `/<id>/<slug>/`: el primer tramo es el id, y la ruta termina en barra.
    const id = ruta.split("/")[1] ?? "";
    const html = ruta.endsWith("/") ? documentos.get(id) : undefined;
    if (html === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(html);
  });

  return new Promise<OrigenDeMedida>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("el servidor de medida no pudo tomar un puerto"));
        return;
      }
      // Que no mantenga vivo el proceso: es infraestructura de medición, no
      // trabajo pendiente.
      server.unref();
      const origin = `127.0.0.1:${address.port}`;
      // El proxy de salida del Chromium (lib/security/egress-proxy.ts) corta el
      // loopback entero: éste es el único hueco, y vive lo que vive el proceso.
      allowEgressOrigin(origin);
      origenVivo = origin;
      resolve({
        origin,
        publicar(html: string, opciones: OpcionesDelDocumento = {}): DocumentoServido {
          const id = randomUUID();
          documentos.set(id, html);
          if (opciones.files || opciones.platformFiles) {
            ficherosPorDocumento.set(
              id,
              new Map([
                ...Object.entries(opciones.files ?? {}).filter(([ruta]) => isPublishableFolderPath(ruta)),
                ...Object.entries(opciones.platformFiles ?? {}).filter(([ruta]) => ruta.startsWith("/openlen/")),
              ]),
            );
          }
          const pagina = opciones.pagina ? `${encodeURIComponent(opciones.pagina)}/` : "";
          return {
            url: `http://${origin}/${id}/${pagina}`,
            soltar: () => {
              documentos.delete(id);
              ficherosPorDocumento.delete(id);
            },
          };
        },
      });
    });
  });
}

let pendiente: Promise<OrigenDeMedida> | null = null;

/**
 * El servidor de medida del proceso. Se arranca la primera vez que se pide.
 *
 * Si no arranca, esto RECHAZA en vez de caer a `setContent`: medir en un
 * origen opaco no es medir peor, es medir OTRA COSA — y el llamador ya sabe
 * qué hacer con «no se pudo medir» (lo anota como `unavailable`, que no es lo
 * mismo que «no hay roturas»). Caer en silencio devolvería justo el fallo que
 * este módulo existe para quitar.
 */
export function origenDeMedida(): Promise<OrigenDeMedida> {
  if (!pendiente) {
    pendiente = crear().catch((err) => {
      // Un fallo no puede envenenar el proceso entero: el siguiente render
      // vuelve a intentarlo.
      pendiente = null;
      throw err;
    });
  }
  return pendiente;
}

/** Lo mínimo que hace falta para poner un documento delante de un navegador.
 *  Estructural a propósito: la `Page` de Puppeteer encaja tal cual, y los
 *  dobles de prueba —que implementan esto a mano y no traen `goto`— también. */
export interface PaginaCargable extends ConEsperaDeRed {
  setContent(html: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
  /** Opcional por los dobles de prueba. Cuando existe se navega a un origen de
   *  verdad en vez de volcar el documento en `about:blank`. */
  goto?(url: string, options?: { waitUntil?: "load"; timeout?: number }): Promise<unknown>;
}

/**
 * Pone el documento delante del navegador EN UN ORIGEN DE VERDAD.
 *
 * `setContent` deja la página en `about:blank`, cuyo origen es opaco: ahí
 * `localStorage` no está vacío, LANZA. Se sirve por HTTP desde 127.0.0.1
 * (contexto seguro en Chromium, sin certificado) y se navega a ella, que es
 * como se sirve publicada.
 *
 * VIVE AQUÍ, Y NO EN CADA RENDERIZADOR, porque tenerlo escrito en un solo sitio
 * ya nos costó una vez: `visual-quality-renderer.ts` navegaba a un origen real
 * desde el 2026-08-26 y `inline-image.ts` —los OJOS del Agente, el renderizador
 * que decide si una página está ROTA— se quedó en `setContent` siete días más.
 * La misma página salía sana por un camino y «con el JavaScript roto» por el
 * otro, y el segundo era el que le cobraba al usuario un ciclo de corrección.
 * Es el mismo patrón que las tres funciones de slug de `b4c7b922`.
 *
 * ⚠️ QUIEN LLAME A ESTO TIENE QUE ABRIRLE PASO AL GUARDIA SSRF: el documento se
 * sirve desde 127.0.0.1, que es EXACTAMENTE lo que el guardia bloquea. Hay que
 * instalarlo con `allowOrigins: [(await origenDeMedida()).origin]` ANTES de
 * cargar, o se corta la navegación misma y no hay página que mirar.
 *
 * El `setContent` se queda SÓLO para los dobles de prueba, que no traen `goto`
 * y que tampoco ejecutan JavaScript de verdad. En producción, si el origen no se
 * puede levantar, esto LANZA: el llamador lo anota como «no se pudo medir», que
 * es honesto, en vez de medir en condiciones que no son las de nadie.
 */
export async function cargarEnOrigenReal(
  page: PaginaCargable,
  html: string,
  opciones: OpcionesDelDocumento = {},
): Promise<void> {
  if (!page.goto) {
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    return;
  }
  const doc = (await origenDeMedida()).publicar(html, opciones);
  try {
    await page.goto(doc.url + (opciones.hash ?? ""), { waitUntil: "load", timeout: 20_000 });
    await esperarALaRed(page, opciones);
  } finally {
    // Con carpeta, el documento se queda lo que dura una medida: la página
    // sigue pidiendo sus ficheros DESPUÉS de cargar (un `fetch` en un clic, un
    // import perezoso). Sin carpeta, se suelta ya, como siempre.
    if (opciones.files && Object.keys(opciones.files).length > 0) setTimeout(doc.soltar, VIDA_CON_CARPETA_MS).unref();
    else doc.soltar();
  }
}

/** Lo que vive un documento con carpeta tras cargar: más que cualquier medida
 *  (los pasos de `use_page` y los ojos acaban antes), y acotado. */
const VIDA_CON_CARPETA_MS = 3 * 60_000;
