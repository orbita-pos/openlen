/**
 * Reglas que toda superficie que ESCRIBE copy necesita, en una sola fuente.
 *
 * Hermana de `lib/ai/today-line.ts` y por el mismo motivo: la fecha vivió un día
 * arreglada sólo en el Agente porque no existía un sitio donde ponerla una vez.
 */

/**
 * El idioma de la página lo manda el brief.
 *
 * Ni el prompt de crear ni el del Chat decían nada del idioma — cero
 * coincidencias de "language" o "idioma" en ninguno de los dos. Medido con seis
 * briefs: cinco acertaron por suerte y uno, escrito íntegramente en español,
 * salió como una página entera en inglés (`lang="en"`, "Time, redefined by
 * hand"). Uno de seis, en un producto cuyos usuarios escriben en español.
 *
 * No dice CUÁL idioma: dice que se deduzca del brief. Un brief en árabe tiene
 * que dar una página en árabe —y en la misma medición el modelo lo hizo bien,
 * con `lang="ar" dir="rtl"`—, así que fijar el español rompería justo eso.
 */
export const LANGUAGE_RULE =
  "IDIOMA: escribe TODA la copy de la página —titulares, párrafos, botones, " +
  "etiquetas de formulario, pie— en el mismo idioma que el BRIEF de abajo. " +
  "Pon ese idioma en `<html lang>`, y `dir=\"rtl\"` si la escritura va de " +
  "derecha a izquierda. Si el brief mezcla idiomas, manda aquel en el que esté " +
  "escrito lo que el negocio ofrece.\n\n";
