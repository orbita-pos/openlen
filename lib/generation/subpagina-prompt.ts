// lib/generation/subpagina-prompt.ts — el mensaje con el que se escribe UNA
// página del sitio que la portada acaba de declarar.
//
// 🔴 VIVE AQUÍ Y NO DENTRO DE LA RUTA porque lo necesitan DOS superficies: la
// ruta `/api/generate`, que es producción, y el arnés de evals, que existe para
// medir producción. Copiarlo en el arnés habría creado la segunda copia que
// después se desincroniza en silencio, y un arnés que mide un prompt que ya no
// se envía mide otra cosa — la cabecera de `scripts/evals-pages.ts` lleva esa
// regla escrita desde que se le quitaron tres atajos por lo mismo.

export interface SubpaginaPrompt {
  /** La portada YA preparada: es la referencia de diseño del sitio entero. */
  readonly portada: string;
  /** El tramo de la ruta, sin barra. */
  readonly slug: string;
  /** Cómo llamó el modelo a esta página en su propio menú. */
  readonly nombre: string;
  /** El MISMO bloque de brief que recibió la portada. */
  readonly briefBlock: string;
}

// En inglés desde el 2026-10-03, SIN MEDIR, como el resto de lo que lee Crear.
export function subpaginaPrompt(o: SubpaginaPrompt): string {
  return `<existing-site>
This is the site's HOME PAGE, already written and approved. It is your design reference:

${o.portada}
</existing-site>

Now write the "${o.nombre}" page of THIS SAME site, at \`/${o.slug}\`.

- Same <head>: the same typefaces, the same :root tokens, the same mode.
- The same header and the same footer, with the same links. The visitor has
  to be able to go back to the home page and jump to the other pages.
- The CONTENT is new and belongs to this page only. Don't repeat the home
  page's sections: this page exists because that content didn't fit there.
- Don't add new pages: the menu links are the ones already there.

${o.briefBlock}`;
}
