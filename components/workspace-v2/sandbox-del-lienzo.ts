// LAS BANDERAS DEL LIENZO, en un solo sitio.
//
// Dos modos (spec docs/superpowers/specs/2026-09-15-un-solo-camino-de-
// renderizado-design.md):
//
//   LOCAL   `srcdoc` — el camino de hoy, y la reserva cuando el lienzo remoto
//           no responde. Origen OPACO: el JavaScript del modelo corre pero no
//           alcanza openlen.com. Sin `allow-modals`, Chromium ignoraba
//           prompt()/confirm() y los botones del usuario morían sin un error
//           (medido el 2026-09-15, `5caa1c73`).
//
//   REMOTO  `src` en `lienzo-<id>.<dominio de páginas>`, otro sitio que la
//           app. Las capacidades de la página publicada, que no lleva
//           sandbox: su origen, su almacenamiento, formularios, ventanas y
//           descargas. Sin `allow-top-navigation`, como el `Nb` de la acción
//           `preview` de Claude Code 2.1.270: la página no puede sacar al
//           usuario de su taller.
//
// Las lee la guarda `el-lienzo-no-se-traga-los-dialogos.test.ts` y la matriz
// `lienzo-igual-que-publicada.browser.test.ts`.

export const SANDBOX_LOCAL = "allow-scripts allow-modals";

export const SANDBOX_REMOTO =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";

/** Portapapeles y pantalla completa, como v0. Cámara, micrófono y
 *  geolocalización NO: la publicada los bloquea con Permissions-Policy. */
export const ALLOW_REMOTO = "clipboard-write; fullscreen";
