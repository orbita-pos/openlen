/** Las rutas que una página publicada llama en SU host y que Caddy pasa a Next
 *  (infra/caddy/Caddyfile, bloque *.openlen.app). Desde el lienzo no
 *  responden como publicadas: dan 403 o 404. Las lee el aviso del lienzo y la guarda del Caddyfile. */
export const RUTAS_SOLO_PUBLICADA: readonly string[] = [
  "/api/f/",
  "/api/chat/",
  "/api/m/",
  "/api/cm/",
  "/api/bk/",
  "/api/b/",
  "/c/",
  // El backend de las páginas (lib/backend): supabase-js llama a la URL
  // ABSOLUTA del proyecto, que contesta también desde el lienzo; un `/rest/v1`
  // o `/auth/v1` RELATIVO sólo contesta en la publicada.
  "/rest/v1/",
  "/auth/v1/",
];

/** La ruta de `url` si es una de la lista Y va al origen de la propia página
 *  (una llamada relativa); si no, null. La URL ABSOLUTA del backend del
 *  proyecto (`https://<ref>.openlen.app/rest/v1/…`) contesta desde el lienzo y
 *  desde los ojos de Len —con los datos de prueba—, así que no cuenta. */
export function rutaSoloPublicada(url: string, origenDeLaPagina: string): string | null {
  let u: URL;
  try {
    u = new URL(url, origenDeLaPagina);
  } catch {
    return null;
  }
  if (u.origin !== origenDeLaPagina) return null;
  return RUTAS_SOLO_PUBLICADA.some((p) => u.pathname.startsWith(p)) ? u.pathname : null;
}
