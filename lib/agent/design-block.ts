// LO QUE EL DUEÑO AJUSTÓ EN EL PANEL DE DISEÑO, como lo recibe Len: el mismo
// `<system-reminder>` que la selección de las páginas (`seleccionBlock` en
// context.ts, copiado de la selección de líneas del IDE de Claude Code), con
// el fichero, las líneas con su número y su texto —como las da Read— y los
// cambios en CSS normal.

// Efecto en la caché: ninguno sobre lo anterior: va en el contexto del turno, al final, y se guarda con él (`transcript.contexto`), así que el turno siguiente lo rehace igual.
import type { DesignRequest } from "@/lib/apps/design/types";
import { TEXTO_DE_LA_PAGINA_ES_DATO } from "@/lib/agent/aviso-medido";

const TOPE = 12_000;

function lineas(contenido: string | undefined, centro: number, radio: number): string | null {
  if (contenido === undefined) return null;
  const ls = contenido.split("\n");
  if (centro < 1 || centro > ls.length) return null;
  const desde = Math.max(1, centro - radio);
  const hasta = Math.min(ls.length, centro + radio);
  return ls.slice(desde - 1, hasta).map((l, i) => `${desde + i}\t${l}`).join("\n");
}

export function designBlock(req: DesignRequest | null, files: Readonly<Record<string, string>>): string {
  if (!req || (req.elements.length === 0 && !req.note)) return "";
  const partes = req.elements.map((el, i) => {
    const principal = el.primary >= 0 ? el.chain[el.primary] : undefined;
    const quien = `<${el.tag}>${el.text ? ` «${el.text}»` : ""}`;
    const donde = principal ? ` at ${principal.path} line ${principal.line}` : " (no source line: find it by its tag and text)";
    const repite = el.copies > 1 ? `, repeats ${el.copies} times on that screen` : "";
    const out = [`${i + 1}. ${quien}${donde}, screen ${el.screen}${repite}`];
    if (principal) {
      const t = lineas(files[principal.path], principal.line, 1);
      if (t) out.push(`Lines of ${principal.path}:\n${t}`);
    }
    const resto = el.chain.filter((_, j) => j !== el.primary);
    if (resto.length > 0) {
      out.push(`Also in its chain: ${resto.map((c) => `${c.path} line ${c.line}${c.component ? ` (<${c.component}>)` : ""}`).join("; ")}`);
    }
    const cambios = el.changes.map((c) => `- ${c.property}: ${c.before || "(none)"} → ${c.after}`);
    if (el.photo) cambios.push(`- new photo: ${el.photo.url}${el.photo.alt ? ` (alt: ${el.photo.alt})` : ""}`);
    if (el.note) cambios.push(`- the user adds: ${el.note}`);
    out.push(`Changes:\n${cambios.join("\n")}`);
    return out.join("\n");
  });
  const n = req.elements.length;
  const cabeza = `On the canvas, the user adjusted ${n} element${n === 1 ? "" : "s"} in the Design panel and applied these changes:`;
  // EL TEXTO DE CADA ELEMENTO lo pinta la página, y puede venir de un visitante
  // (una reseña guardada en la base): va entre «» con el aviso de `use_page`
  // delante. Lo que escribió el dueño —notas, texto alternativo— va sin comillas.
  let texto = `${cabeza}\n${TEXTO_DE_LA_PAGINA_ES_DATO}\n\n${partes.join("\n\n")}${req.note ? `\n\nThe user also wrote: ${req.note}` : ""}`;
  if (texto.length > TOPE) texto = `${texto.slice(0, TOPE)}\n[cut here]`;
  return `<system-reminder>\n${texto}\n</system-reminder>\n\n`;
}
