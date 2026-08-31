// ABRIR UN DESTINO DEL LIENZO, DESDE EL TALLER.
//
// EL FALLO (bug #2 de Jesús, «los links tipo whatsapp no los abre el editor»).
// El lienzo corre con `sandbox="allow-scripts"`: origen opaco, sin
// `allow-popups` y sin `allow-top-navigation`. Con esa caja, Chromium RECHAZA
// toda navegación a un protocolo externo:
//
//   "Navigation to external protocol blocked by sandbox, because it doesn't
//    contain any of: 'allow-top-navigation-to-custom-protocols',
//    'allow-top-navigation-by-user-activation', 'allow-top-navigation', or
//    'allow-popups'."
//
// `use-page-links.ts` le dejaba esos clics al navegador —«que el navegador
// mande»— y el navegador no podía. El aviso sale en la consola DE DENTRO del
// lienzo: el usuario no la ve, y el padre tampoco puede leerla porque el origen
// es opaco. Pulsabas el teléfono o el WhatsApp de tu propia página y no pasaba
// absolutamente nada.
//
// Es lo mismo que ya se hacía con http(s), y por la misma razón: LO ABRE EL
// PADRE, que no está en caja.
//
// NO ES UN CASO RARO. `mailto:` aparece en 49 de los 292 HTML del corpus y
// `tel:` en 10 — y la caja «Destino» del inspector convierte un teléfono suelto
// en `tel:` y un correo suelto en `mailto:` (ver `normalize-href.ts`), o sea que
// el producto FABRICA enlaces que él mismo no sabía abrir.

/** Esquemas que el taller NO abre nunca, y por qué:
 *
 *  - `javascript:` y `vbscript:` — se ejecutarían con el ORIGEN DE OPENLEN. Es
 *    justo la frontera que el origen opaco del lienzo existe para levantar.
 *  - `data:`, `blob:`, `filesystem:`, `about:`, `view-source:` — un `<a>` del
 *    padre SÍ puede navegar a ellos, así que un destino así se llevaría el
 *    taller por delante en vez de entregárselo al sistema.
 *  - `file:` — el disco del usuario.
 *
 *  Todo lo demás (`mailto`, `tel`, `sms`, `whatsapp`, `tg`, `geo`, lo que
 *  registre el sistema) se entrega, porque es EXACTAMENTE lo que hará el enlace
 *  cuando la página esté publicada. La lista es de PROHIBIDOS y no de
 *  permitidos a propósito: una lista de permitidos deja mudo el siguiente
 *  esquema de contacto que aparezca, que es el fallo que esto arregla.
 */
const PROHIBIDOS = new Set([
  "javascript",
  "vbscript",
  "data",
  "blob",
  "filesystem",
  "file",
  "about",
  "view-source",
]);

export type Destino = "http" | "externo" | "prohibido";

/**
 * En qué cubo cae un destino que llega del lienzo.
 *
 * Se limpian TAB, LF y CR antes de mirar porque **el navegador también lo
 * hace**: `java\tscript:alert(1)` es `javascript:` para él, y comparar el texto
 * crudo dejaría pasar justo lo que la lista prohíbe.
 *
 * Y se exige un esquema explícito: sin él, un valor como `alert(1)` o
 * `/cuenta` no es «un protocolo raro» sino una RUTA RELATIVA, y entregársela a
 * un `<a>` del padre navegaría a openlen.com/…
 */
export function destinoDelLienzo(url: string): Destino {
  const limpio = url.replace(/[\t\n\r]/g, "").trim();
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(limpio);
  if (!m) return "prohibido";
  const esquema = m[1].toLowerCase();
  if (esquema === "http" || esquema === "https") return "http";
  return PROHIBIDOS.has(esquema) ? "prohibido" : "externo";
}

export type Apertura =
  /** http(s) con un gesto del usuario detrás: la pestaña se abre. */
  | "abierta"
  /** http(s) SIN activación: el navegador lo va a bloquear, y hay que decirlo. */
  | "sin-gesto"
  /** Otro esquema: se le entrega al sistema, que abrirá el teléfono o WhatsApp. */
  | "entregada"
  /** No se abre desde aquí. */
  | "prohibido";

/**
 * Abre un destino del lienzo desde el documento del TALLER.
 *
 * 🔴 LA ACTIVACIÓN SE LEE ANTES DE ABRIR, Y ESO ES EL ARREGLO DE UN AVISO QUE
 * MENTÍA. `window.open` CONSUME la activación transitoria, así que leerla
 * después da `false` siempre; y con `noopener` Chromium devuelve `null` AUNQUE
 * haya abierto la pestaña (medido). La primera versión de este aviso combinaba
 * las dos lecturas —las dos post mortem— y por eso «tu navegador bloqueó la
 * pestaña» salía en CADA clic a un enlace externo, con la pestaña abierta
 * delante. Lo que sí distingue es si HABÍA gesto antes de intentarlo.
 *
 * Lo que sigue sin poder distinguirse: un bloqueador agresivo (Brave, una
 * extensión) que corta una apertura que sí tenía activación. Eso no deja rastro
 * legible desde aquí, y fingir que sí lo dejaría es la mentira que se quitó.
 */
export function abrirDesdeElTaller(url: string): Apertura {
  const cubo = destinoDelLienzo(url);
  if (cubo === "prohibido") return "prohibido";

  if (cubo === "http") {
    const habiaGesto =
      typeof navigator !== "undefined" && "userActivation" in navigator
        ? (navigator as Navigator & { userActivation?: { isActive: boolean } })
            .userActivation?.isActive !== false
        : true;
    window.open(url, "_blank", "noopener,noreferrer");
    return habiaGesto ? "abierta" : "sin-gesto";
  }

  // UN PROTOCOLO EXTERNO SE ENTREGA CON UN `<a>`, no con `window.open`.
  // `window.open("tel:…")` abre una pestaña que el navegador cierra a
  // continuación —un parpadeo en blanco—, mientras que un ancla del documento
  // del taller le pasa el destino al sistema y NO navega: el taller se queda
  // donde estaba, con las ediciones sin guardar intactas.
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return "entregada";
}
