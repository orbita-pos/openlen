// lib/agent/valores-de-tema.ts — los valores que `cambiar_tema` aplicó, en una
// línea, para que sobrevivan en el historial.
//
// 🔴 EL FALLO QUE CIERRA (H08-b de `plans/auditoria-len-vs-claude-code-2026-09-22.md`).
// El historial que se le reenvía al modelo borra los argumentos de cada llamada
// pasada y se queda con el resumen de la tarjeta. El de `cambiar_tema` es la
// frase del modelo —«acento morado»—, así que el color exacto se perdía: a
// «vuelve al morado que teníamos» contestaba con el violeta que adivina
// cualquiera, no con el del dueño (C15, medido 2/2 el 2026-09-22).
//
// La tarjeta sigue enseñando la frase —fue una decisión que el hex suelto no la
// sustituyera—; esto viaja aparte y sólo lo lee el historial.
//
// Puro: lo importan la herramienta y la batería.

export function valoresDeTema(o: {
  readonly accent?: string;
  readonly fuente?: string;
  readonly radius?: string;
  readonly modo?: string;
}): string {
  return [
    o.accent ? `acento ${o.accent}` : "",
    o.fuente ? `fuente ${o.fuente}` : "",
    o.radius ? `radio ${o.radius}` : "",
    o.modo ? `modo ${o.modo}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
