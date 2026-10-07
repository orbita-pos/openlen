/**
 * LAS FOTOS DE UN MENSAJE — varias, como los adjuntos de DeepSeek, y con el
 * tope de los compositores (`MAX_REFERENCIAS`, lib/ai/referencia-adjunta.ts):
 * el mismo número, para que la interfaz y la ruta no puedan discrepar.
 *
 * La columna `projectChatMessages.attachedImage` es JSONB: guarda un objeto
 * (todas las filas de antes, y las de una sola foto) o una lista (dos o más).
 * Sin migración; quien lee pasa siempre por `photosOf`.
 *
 * Puro: lo usan la ruta, la transcripción y el cliente.
 */
import { MAX_REFERENCIAS } from "@/lib/ai/referencia-adjunta";

export interface ChatPhoto {
  readonly url: string;
  readonly alt?: string;
}

export const MAX_PHOTOS_PER_MESSAGE = MAX_REFERENCIAS;

export function photosOf(v: ChatPhoto | readonly ChatPhoto[] | null | undefined): ChatPhoto[] {
  if (!v) return [];
  return Array.isArray(v) ? [...(v as readonly ChatPhoto[])] : [v as ChatPhoto];
}

export function photosForRow(photos: readonly ChatPhoto[]): ChatPhoto | ChatPhoto[] | null {
  if (photos.length === 0) return null;
  return photos.length === 1 ? photos[0]! : [...photos];
}
