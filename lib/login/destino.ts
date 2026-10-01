// El `?next=` que el middleware le pone al login. Antes guardaba sólo la ruta
// y perdía la query: `/llamada?project=…` volvía sin proyecto, y el regreso a
// la app del teléfono (`/movil/entrar?estado=…`) se rompía. El login ya sanea
// `next` (sólo rutas internas), así que la query viaja dentro sin más.
export function destinoDelLogin(rutaSinIdioma: string, query: string): string {
  return `${rutaSinIdioma}${query}`;
}
