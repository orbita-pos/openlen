// lib/len-bench/fila-del-dueno.ts — cómo se llama el proyecto que Len edita.
//
// Len LEE el título en el estado de cada turno (`summarizeProjectState`) y el
// brief en `redesign.ts`. El arnés viejo los llenaba con «Agent Eval <caso>» y
// «Agent eval throwaway fixture», y en la calibración del 2026-09-23 Len leyó
// «len-bench-telefono-nuevo-sin-lada», dijo «this is a tricky eval» y se pasó
// 4 minutos adivinando qué quería el autor del caso. Un dueño de verdad que
// trae su página no le da a Len el nombre del examen: se titula como lo titula
// producción y ya.

import { titleFromHtml } from "@/lib/projects/titulo-del-html";
import type { ProjectData } from "@/lib/projects/types";

export function filaComoLaDeUnDueno(inicio: Pick<ProjectData, "html">): { title: string; brief: string } {
  return {
    // `createProject` (lib/projects.ts): el <title> del documento, y el mismo
    // último recurso.
    title: titleFromHtml(inicio.html) ?? "Untitled page",
    // El brief con el que /api/projects/from-html guarda una página pegada.
    brief: "Pasted HTML",
  };
}
