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
 *
 * 🔴 EN INGLÉS desde el 2026-10-03, SIN MEDIR (Jesús: «traducir para los dos»):
 * Crear y el Chat leen ya el contrato en inglés, así que aparece una tercera
 * colisión que el 07/09 no existía — el idioma de las instrucciones. Por el
 * mismo molde que el rubro, se nombra en la última frase en vez de esperar a
 * que tire. Lo medido el 07/09 (el prompt en castellano no arrastraba un brief
 * en árabe) es la razón para esperar que el inglés tampoco arrastre; no es una
 * medición de esto.
 */
export const LANGUAGE_RULE =
  "LANGUAGE: write ALL of the page's copy —headlines, paragraphs, buttons, " +
  "form labels, footer, and the NAME you give the product— in the same " +
  "language as the BRIEF below, which is the language of the user's request. " +
  "Put that language in `<html lang>`, and `dir=\"rtl\"` if the script is " +
  "written right to left. If the brief mixes languages, the one that wins is " +
  "the language in which what the business offers is written. " +
  "The INDUSTRY doesn't decide: a piece of software, an API, a dashboard for " +
  "teams or a luxury brand is written in the brief's language even when that " +
  "genre is usually seen in another one — if the brief is in Spanish, there " +
  "isn't a single headline or button in another language. " +
  "Nor does the language these instructions are written in decide it: it is " +
  "the same for every page, whatever language the page ends up in.\n\n";
