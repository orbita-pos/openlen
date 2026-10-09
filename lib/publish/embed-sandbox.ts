// Aislamiento de las superficies que sirven HTML de proyecto desde la APP.
//
// El problema (auditoría 2026-07-29): /api/projects/<id>/raw,
// /api/projects/<id>/versions/<vid>/raw y /api/sections/<id>/preview sirven
// documentos desde el MISMO origen que la app y sin CSP, y los iframes que los
// muestran usaban `allow-scripts allow-same-origin` — dos banderas que juntas
// anulan el sandbox. Medido en navegador: un script dentro de esos documentos
// leía cookies, leía y ESCRIBÍA el DOM del padre y hacía fetch autenticado.
//
// La CSP `sandbox` sin `allow-same-origin` le da al documento un origen OPACO:
// sus scripts corren, pero no alcanzan cookies, storage ni la API con la sesión.
//
// 🔴 DESDE EL 2026-10-04, SIEMPRE, también en pestaña propia. Hasta ese día la
// pestaña («abrir en pestaña», `?bake=1`) se servía SIN sandbox para que los
// clics del usuario funcionaran, con el argumento de que el contenido venía
// saneado. Era falso desde el 2026-08-26 —lo que escribe Len y lo remezclado
// llevan su JavaScript— y la entrada como Vercel lo extendió a lo pegado y lo
// clonado: ese JavaScript corría como openlen.com, con la sesión del dueño.
//
// La pestaña de verdad ya no sale de aquí: `/raw?bake=1` redirige al lienzo,
// `lienzo-<id>.<dominio de páginas>`, un origen PROPIO de otro sitio donde la
// página tiene su JavaScript y su almacenamiento, como publicada. Lo que queda
// en este fichero es la reserva —lienzo apagado, un `/raw` abierto a mano, un
// cliente sin `Sec-Fetch-Dest`—, y la reserva nunca es el origen de la app.

/** `sandbox` SIN allow-same-origin → origen opaco. Los scripts siguen
 *  corriendo (el CDN de Tailwind es lo que pinta estas previsualizaciones),
 *  pero ya no son los de openlen.com. (La compartía el preview de la sección
 *  Marketing, quitada el 2026-10-08.) */
export const EMBED_SANDBOX_CSP = "sandbox allow-scripts";

/** La misma, en pestaña propia: origen opaco, pero con lo que una página
 *  navegable necesita — ventanas (y que salgan sin el sandbox), formularios y
 *  diálogos. La del enlace de vista previa (`app/p/[id]/route.ts`) más
 *  `allow-popups-to-escape-sandbox`. */
export const TAB_SANDBOX_CSP =
  "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals";

/** Destinos en los que el documento se pinta DENTRO de otra página. */
const FRAMED = new Set(["iframe", "frame", "embed", "object"]);

/** ¿Esta respuesta va incrustada? El header lo pone el navegador y una página
 *  no puede falsificarlo (es un nombre prohibido). */
export function isFramedRequest(req: Request): boolean {
  const dest = req.headers.get("sec-fetch-dest")?.trim().toLowerCase() ?? "";
  return FRAMED.has(dest);
}

/** Headers a mezclar en la respuesta: SIEMPRE una CSP `sandbox` sin
 *  `allow-same-origin`. Incrustado, la estricta; en pestaña (o sin el header,
 *  que no se sabe), la navegable. */
export function embedSandboxHeaders(req: Request): Record<string, string> {
  return { "content-security-policy": isFramedRequest(req) ? EMBED_SANDBOX_CSP : TAB_SANDBOX_CSP };
}
