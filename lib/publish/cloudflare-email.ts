// Cloudflare ofusca los correos de las páginas publicadas — y nuestra propia
// CSP mata al script que los descifra.
//
// MEDIDO el 2026-08-24 sobre una página recién publicada:
//
//   texto visible: [email protected]
//   href:          /cdn-cgi/l/email-protection#066e696a674660696569286776
//   consola:       Loading the script '/cdn-cgi/scripts/…/email-decode.min.js'
//                  violates the following Content Security Policy directive:
//                  "script-src 'sha256-…' 'sha256-…' 'sha256-…'"
//
// La cadena entera: Cloudflare reescribe cada dirección de correo del HTML que
// proxea y mete un script que la descifra en el navegador. El sellado
// (`seal.rs`) pina `script-src` a los hashes de los scripts que el documento YA
// traía, así que ese script inyectado no entra nunca. Resultado: el visitante
// lee el marcador de Cloudflare donde debería estar el correo del negocio.
//
// NO PASA EN EL EDITOR. `preview-bake.ts` excluye el sellado a propósito, así
// que en la vista previa el script carga y el correo se ve perfecto. Se ve bien
// al mirar y sale muerto al publicar, que es la peor forma de fallar.
//
// El par de comentarios de abajo es la salida oficial de Cloudflare: lo que
// quede entre ellos no lo toca. Se aplica al documento ENTERO y como ÚLTIMO
// paso —después de optimizar, hornear y sellar— para que ningún parser
// posterior lo reordene ni lo borre.
//
// POR QUÉ EN EL REPO Y NO SÓLO EN EL PANEL. El interruptor de la zona
// (Scrape Shield → Email Address Obfuscation) hace lo mismo de golpe, y hay que
// apagarlo igual. Pero una configuración que sólo vive en un panel es lo que
// convirtió "emitir un certificado" en "emitir un certificado Y acordarse de un
// hook que vive fuera del repo" — y nadie se acuerda. Con esto, una página
// publicada trae su correo intacto aunque el interruptor vuelva a encenderse, y
// aunque quien despliegue OpenLen no sea nosotros.

export const EMAIL_OFF = "<!--email_off-->";
export const EMAIL_ON = "<!--email_on-->";

/**
 * Envuelve el documento para que Cloudflare no toque sus correos.
 *
 * Idempotente por el propio marcador: publicar dos veces no anida nada.
 *
 * Va DENTRO de `<html>` y no envolviendo el doctype porque un comentario antes
 * de `<html>` es legal pero se cuela en modos de inserción raros de algunos
 * parsers; como primer hijo de `<html>` es el sitio previsto por la norma y por
 * el que ya pasan los tres tipos de documento que publicamos.
 *
 * Sin `<html>` —un caso que el normalizador no debería dejar salir— envuelve la
 * cadena entera: perder los correos en silencio sería peor que un comentario
 * suelto en un documento que ya venía roto.
 */
export function optOutOfEmailObfuscation(html: string): string {
  if (html.includes(EMAIL_OFF)) return html;

  const apertura = /<html[^>]*>/i.exec(html);
  if (!apertura) return EMAIL_OFF + html + EMAIL_ON;

  const inicio = apertura.index + apertura[0].length;
  const cierre = html.toLowerCase().lastIndexOf("</html>");
  if (cierre === -1 || cierre < inicio) {
    return html.slice(0, inicio) + EMAIL_OFF + html.slice(inicio) + EMAIL_ON;
  }
  return (
    html.slice(0, inicio) +
    EMAIL_OFF +
    html.slice(inicio, cierre) +
    EMAIL_ON +
    html.slice(cierre)
  );
}
