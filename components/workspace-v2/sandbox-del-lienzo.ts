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
//           sandbox: su origen, su almacenamiento, formularios, ventanas,
//           descargas y el puntero bloqueado (un juego en primera persona mira
//           con el ratón). Sin `allow-top-navigation`, como la acción `preview`
//           de Claude Code: la página no puede sacar al usuario de su taller.
//
// Las lee la guarda `el-lienzo-no-se-traga-los-dialogos.test.ts` y la matriz
// `lienzo-igual-que-publicada.browser.test.ts`.

export const SANDBOX_LOCAL = "allow-scripts allow-modals allow-pointer-lock";

export const SANDBOX_REMOTO =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-pointer-lock";

/** Portapapeles y pantalla completa, como v0; y cámara, micrófono y ubicación,
 *  que la publicada deja pedir (`lib/publish/permissions-policy.ts`). En un
 *  marco, Chrome le pregunta al usuario a nombre de openlen.com y guarda la
 *  respuesta para openlen.com: quien la concede en el lienzo de un proyecto la
 *  concede a los lienzos de los proyectos que abra después (los suyos y los que
 *  le compartan). La publicada no tiene ese efecto: allí el permiso es de su
 *  propio origen. */
export const ALLOW_REMOTO = "clipboard-write; fullscreen; camera; microphone; geolocation";

/** THE FRAME OF AN AGENT'S TOOL (spec local 2026-11-22-artifacts-de-len, §2), on the web and the phone. Its
 *  code is written by an agent that sometimes reads other people's text, and what it stores must not leave it: the
 *  canvas's flags without popups (a popup escaping the sandbox is a window the tool's policy no longer governs), and no
 *  camera, microphone or location — its host answers `permissions-policy` with all three off anyway. */
export const SANDBOX_HERRAMIENTA_AGENTE =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-downloads allow-pointer-lock";

export const ALLOW_HERRAMIENTA_AGENTE = "clipboard-write; fullscreen";
