/**
 * Saca el documento HTML de lo que el modelo respondió.
 *
 * El prompt dice "el primer carácter de tu respuesta es `<`", y a veces el
 * modelo escribe igualmente una frase antes: *"Here is a complete,
 * self-contained HTML page for a neighborhood taquería…"*. Hasta ahora sólo se
 * quitaban las vallas de markdown, así que la comprobación `^<!doctype` fallaba
 * y la ruta contestaba "Generation failed" — con la página entera ya escrita y
 * pagada, tirada por una frase de cortesía.
 *
 * Medido: con el brief de la taquería el modelo escribió el preámbulo en el
 * intento inicial Y en el reintento. 2 de 2 — no es mala suerte, es que ese
 * brief lo provoca. Y el usuario habría visto un muro.
 *
 * Cortar en `<!doctype` no relaja ninguna comprobación: lo que se emite se
 * sigue exigiendo completo, sellado y sin marcadores. Sólo deja de tirar una
 * página buena por lo que el modelo dijo ANTES de escribirla.
 */
export function extractDocument(raw: string): string {
  let out = raw.trim();

  // 1. Vallas de markdown, si envolvió el documento entero.
  out = out.replace(/^```(?:html|xml)?[\t ]*\r?\n?/i, "");
  out = out.replace(/\r?\n?[\t ]*```\s*$/i, "");
  out = out.trim();

  // 2. Preámbulo antes del documento. Se corta en el PRIMER `<!doctype`: si el
  //    modelo escribió dos, el segundo es contenido de la página (un ejemplo de
  //    código, típico en una página de documentación) y cortar ahí la partiría.
  const doctype = out.search(/<!doctype\s+html/i);
  if (doctype > 0) out = out.slice(doctype);

  // 3. Epílogo. Sólo se recorta cuando el documento cierra de verdad, para no
  //    inventar un final en una respuesta truncada — esa tiene que seguir
  //    fallando su propia comprobación.
  const close = out.toLowerCase().lastIndexOf("</html>");
  if (close !== -1) out = out.slice(0, close + "</html>".length);

  return out.trim();
}
