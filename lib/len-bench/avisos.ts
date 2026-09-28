// lib/len-bench/avisos.ts — lo que un encargo NO puede aprobar con lo que la
// corrida permite, dicho al cargarlo.
//
// Como el corredor de evals de Claude Code al cargar un caso, que avisa cuando un
// grader no puede pasar con las herramientas que tiene. En la calibración del 2026-09-24,
// `cambialo-y-publicalo` salió 0 de 3 sin que Len hiciera nada mal: `publicar`
// le pide al dueño la dirección, la ficha no la traía, y el dueño simulado
// contestó tres veces «tú sabrás». La validación no lo vio porque da la
// solución por publicada sin pasar por la tarjeta.

import type { Encargo } from "./tipos";

export function avisosDelEncargo(e: Encargo): string[] {
  const avisos: string[] = [];
  const votaPublicar = e.graders.some((g) => g.nombre === "len-publico" && g.puntua !== false);
  if (!votaPublicar) return avisos;
  if (!e.publicaLen) {
    avisos.push("«len-publico» no puede pasar: el encargo no concede publicar (publicaLen), así que nadie toca la tarjeta «Publicar»");
  } else if (!e.ficha.datos.subdominio?.trim()) {
    // `publicar` no elige la dirección (catalog.ts): o la tiene el proyecto,
    // o la dice el dueño. Len-Bench crea el proyecto sin ninguna.
    avisos.push("«len-publico» no puede pasar: publicar pide al dueño la dirección y su ficha no la trae (datos.subdominio)");
  }
  return avisos;
}
