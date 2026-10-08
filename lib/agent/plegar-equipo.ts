// PLEGAR EL CHAT DEL EQUIPO en el historial de Len: las filas de persona dejan
// de ser filas y viajan, en su sobre, delante del turno siguiente; las que
// llegaron después del último turno van delante de la petición de AHORA. Cada
// turno lleva quién lo pidió. Puro: lo prueba vitest.

import type { FilaCruda } from "@/lib/projects/chat";
import type { FilaDelHistorial } from "@/lib/agent/transcripcion";
import { photosOf } from "@/lib/projects/chat-photos";
import { neutralizarMarcas, quienPide, sobreDelEquipo, type AutorDelEquipo, type MensajeDelEquipo } from "./equipo";

export function plegarEquipo(
  filas: readonly FilaCruda[],
  gente: readonly AutorDelEquipo[],
  duenoId: string,
  nombreDe: (id: string) => string | null = () => null,
): { filas: FilaDelHistorial[]; ahora: string } {
  const persona = new Map(gente.map((p) => [p.userId, p]));
  const fuera: FilaDelHistorial[] = [];
  let pendientes: MensajeDelEquipo[] = [];
  const sobre = () => {
    const s = sobreDelEquipo(pendientes, gente, nombreDe);
    pendientes = [];
    return s ? `${s}\n` : "";
  };
  for (const f of filas) {
    if (f.tipo === "persona") {
      if (f.autorId) {
        const fotos = photosOf(f.fila.attachedImage);
        pendientes.push({ autorId: f.autorId, texto: f.fila.userText, menciones: f.menciones ?? [], createdAt: f.createdAt, ...(fotos.length > 0 ? { fotos } : {}) });
      }
      continue;
    }
    const pide = quienPide(persona.get(f.autorId ?? duenoId) ?? null);
    // Lo escrito, con las marcas a mano neutralizadas: sólo vale la del servidor.
    fuera.push({ ...f.fila, userText: neutralizarMarcas(f.fila.userText), prefijoDelEquipo:`${sobre()}${pide ? `${pide}\n` : ""}` });
  }
  return { filas: fuera, ahora: sobre() };
}
