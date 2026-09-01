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

import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";

export interface DocumentoServido {
  /** El URL que hay que abrir en el navegador. */
  readonly url: string;
  /** Deja de servirlo. Llamar SIEMPRE al terminar el render, o el documento
   *  se queda en memoria hasta que muera el proceso. */
  soltar(): void;
}

export interface OrigenDeMedida {
  /** `host:puerto`, tal y como lo quiere `allowOrigins` del guardia SSRF. */
  readonly origin: string;
  publicar(html: string): DocumentoServido;
}

/** Los documentos vivos ahora mismo, por identificador de ruta. */
const documentos = new Map<string, string>();

function crear(): Promise<OrigenDeMedida> {
  const server: Server = createServer((req, res) => {
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
    const id = ruta.replace(/^\/+|\/+$/g, "");
    const html = documentos.get(id);
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
      resolve({
        origin,
        publicar(html: string): DocumentoServido {
          const id = randomUUID();
          documentos.set(id, html);
          return {
            url: `http://${origin}/${id}/`,
            soltar: () => {
              documentos.delete(id);
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
export interface PaginaCargable {
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
export async function cargarEnOrigenReal(page: PaginaCargable, html: string): Promise<void> {
  if (!page.goto) {
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    return;
  }
  const doc = (await origenDeMedida()).publicar(html);
  try {
    await page.goto(doc.url, { waitUntil: "load", timeout: 20_000 });
  } finally {
    doc.soltar();
  }
}
