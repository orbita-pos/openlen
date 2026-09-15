/** Tope de un documento HTML de proyecto: lo que acepta guardar
 *  (`app/api/projects/[id]/html`) y lo que acepta subir el lienzo
 *  (`app/api/lienzo`). Compartido para que no puedan discrepar: un documento
 *  que se guarda y luego no se puede ver sería el lienzo mintiendo otra vez. */
export const MAX_HTML_BYTES = 8 * 1024 * 1024;
