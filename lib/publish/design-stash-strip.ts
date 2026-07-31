// data-ol-was (la memoria de originales del inspector) vive en el HTML del
// proyecto para que el reset funcione entre sesiones — pero es estado del
// editor: la página publicada sale limpia. El DOM serializa el atributo con
// comillas dobles y el JSON interno entity-escaped (&quot;), así que el valor
// nunca contiene una comilla cruda; la variante simple cubre HTML pegado.
export function stripDesignStash(html: string): string {
  return html
    .replace(/\s*data-ol-was="[^"]*"/gi, "")
    .replace(/\s*data-ol-was='[^']*'/gi, "");
}
