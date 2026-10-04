/** Las rutas que una página publicada llama en SU host y que Caddy pasa a Next
 *  (infra/caddy/Caddyfile, bloque *.openlen.app). Desde el lienzo no
 *  responden como publicadas: /api/d da 403 por origen (request-origin.ts), las
 *  demás 403 o 404. Las lee el aviso del lienzo y la guarda del Caddyfile. */
export const RUTAS_SOLO_PUBLICADA: readonly string[] = [
  "/api/d/",
  "/api/f/",
  "/api/chat/",
  "/api/m/",
  "/api/cm/",
  "/api/bk/",
  "/api/b/",
  "/c/",
];
