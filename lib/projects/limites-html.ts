/** Tope de un documento HTML de proyecto. Lo comparten las TRES puertas por
 *  las que entra o sale un documento: lo que acepta guardar
 *  (`app/api/projects/[id]/html`), lo que acepta INGERIR desde fuera
 *  (`app/api/projects/from-html`) y lo que acepta subir el lienzo
 *  (`app/api/lienzo`).
 *
 *  Compartido para que no puedan discrepar: un documento que se guarda y luego
 *  no se puede ver sería el lienzo mintiendo otra vez, y uno que se puede pegar
 *  pero no guardar se pierde entero después de que el usuario lo pegue.
 *
 *  La de `from-html` era una tercera copia suelta del mismo número hasta el
 *  2026-09-15. */
export const MAX_HTML_BYTES = 8 * 1024 * 1024;
