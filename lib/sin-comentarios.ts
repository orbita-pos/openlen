/**
 * Un fichero de código SIN sus comentarios.
 *
 * Para qué: varias guardas leen el código fuente para clavar una decisión —«la
 * barra ya no monta el idioma», «este componente no importa el perfil»— y una
 * LÁPIDA QUE NOMBRA LO RETIRADO NO ES LO RETIRADO. Un comentario correcto
 * («aquí vivía `useSession`, se fue el 31/08») rompía la guarda que decía la
 * verdad. El código muerto sigue hablando, y el vivo también.
 *
 * 🔴 EL ORDEN NO ES CAPRICHO: PRIMERO LAS DE LÍNEA, DESPUÉS LAS DE BLOQUE.
 *
 * Al revés, un `/*` que viva DENTRO de un comentario de línea abre un bloque
 * falso que se traga el código hasta el siguiente cierre. No es hipotético y no
 * es raro: basta con nombrar una ruta con comodín —`messages/` + `*` + `/topbar.json`—
 * en un comentario. Eso borró la declaración de `useTranslations` de
 * `account-menu.tsx` y dejó ciegas a DOS guardas a la vez: una salió verde con
 * el fallo delante, y la otra roja sin que nadie hubiera tocado lo que medía.
 *
 * No parsea: no distingue un `//` dentro de una cadena. Por eso las de línea se
 * exigen al PRINCIPIO de la línea, que es donde nunca está una URL.
 */
export function sinComentarios(codigo: string): string {
  return codigo.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
