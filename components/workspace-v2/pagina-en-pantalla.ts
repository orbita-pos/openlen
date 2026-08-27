// QUÉ PÁGINA SE VE MIENTRAS SE ESCRIBE OTRA.
//
// Cuando la medición encuentra rotura de verdad, el servidor reescribe la
// página y el stream empieza de cero. El lienzo pintaba ese stream desde el
// primer byte, así que durante unos segundos la pantalla enseñaba un documento
// a medio abrir: sin `<body>`, sin estilos, en blanco. Para quien está mirando
// eso no se lee como «está escribiendo otra», se lee como «me borró la página».
//
// La regla es sencilla: un documento sin `<body>` todavía no es una página, es
// un preámbulo. Hasta que llega el `<body>` se sigue enseñando la anterior; a
// partir de ahí manda la nueva y se la ve escribirse, que es lo bueno de esto.
//
// NO es una animación ni un retraso: no hay temporizador, no hay estado. Es una
// función del contenido, así que se puede probar sin navegador.

/** ¿Este texto ya es una página que se puede enseñar? */
export function yaEsPagina(html: string): boolean {
  return /<body[\s>]/i.test(html);
}

/**
 * El documento que debe pintarse.
 *
 * `entrando` es lo que lleva escrito el stream actual; `anterior`, la última
 * página completa que se enseñó. Sin anterior se pinta lo que haya — más vale
 * un preámbulo que un vacío, y en la primera generación no hay nada que
 * conservar.
 */
export function paginaEnPantalla(entrando: string, anterior: string): string {
  if (yaEsPagina(entrando)) return entrando;
  return anterior || entrando;
}
