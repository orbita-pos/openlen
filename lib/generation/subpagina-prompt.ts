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

export function subpaginaPrompt(o: SubpaginaPrompt): string {
  return `<sitio-existente>
Esta es la PORTADA del sitio, ya escrita y aprobada. Es tu referencia de diseño:

${o.portada}
</sitio-existente>

Escribe ahora la página «${o.nombre}» de ESTE MISMO sitio, en \`/${o.slug}\`.

- Mismo <head>: las mismas tipografías, los mismos tokens de :root, el mismo modo.
- La misma cabecera y el mismo pie, con los mismos enlaces. El visitante tiene
  que poder volver a la portada y saltar a las demás páginas.
- El CONTENIDO es nuevo y es sólo de esta página. No repitas las secciones de la
  portada: esta página existe porque ese contenido no cabía ahí.
- No añadas páginas nuevas: los enlaces del menú son los que ya hay.

${o.briefBlock}`;
}
