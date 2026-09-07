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
 *
 * 🔴 LO QUE QUEDA VIVO, medido el 2026-09-07 en tres corridas del cohorte: la
 * regla bajó el fallo de 1 de 6 a 1 de 16, y ahí se quedó — UNA página en
 * inglés por corrida, siempre la misma familia. `documentacion` en dos
 * corridas, `saas` en la tercera, y el brief de `saas` no tiene ni una palabra
 * en inglés: sale «Simple, transparent pricing» y hasta un nombre inventado en
 * inglés, «Resolvio».
 *
 * Lo que TIRA no son las palabras del brief —se comprobó que no hay mezcla que
 * disparara la última frase— ni el prompt, que es íntegramente castellano. Es
 * el GÉNERO: el que nombra esta lápida arriba era un reloj de lujo («Time,
 * redefined by hand»), no software. La familia es «rubro cuyo marketing suele
 * verse en inglés», y por eso la regla ahora la nombra en vez de describir sólo
 * el caso general — mismo molde que usa Claude Code, donde ninguna prohibición
 * se queda sin su condición escrita al lado.
 */
export const LANGUAGE_RULE =
  "IDIOMA: escribe TODA la copy de la página —titulares, párrafos, botones, " +
  "etiquetas de formulario, pie, y el NOMBRE que le pongas al producto— en el " +
  "mismo idioma que el BRIEF de abajo. " +
  "Pon ese idioma en `<html lang>`, y `dir=\"rtl\"` si la escritura va de " +
  "derecha a izquierda. Si el brief mezcla idiomas, manda aquel en el que esté " +
  "escrito lo que el negocio ofrece. " +
  "El RUBRO no decide: un software, una API, un panel para equipos o una marca " +
  "de lujo se escriben en el idioma del brief aunque el género suela verse en " +
  "otro — si el brief está en castellano, no hay ni un titular ni un botón en " +
  "otra lengua.\n\n";
