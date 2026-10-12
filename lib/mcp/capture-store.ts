// LAS CAPTURAS DE view_page, 10 MINUTOS EN MEMORIA, para la URL que va en el
// texto: ChatGPT no garantiza enseñarle al modelo la imagen del resultado
// (informe, matriz de clientes). El id son 32 bytes al azar: una URL de
// capacidad (quien la tiene, la ve; nadie la adivina). En memoria porque
// OpenLen corre en UN proceso (openlen-app.service); un reinicio las pierde y
// da 404, igual que caducar. Va en `globalThis` y no en una variable del
// módulo: Next puede dar a cada ruta su propia copia del módulo, y view_page
// guarda en la de /api/mcp mientras /api/mcp/capture lee la suya.
import crypto from "node:crypto";

export const CAPTURE_TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 30;

interface Entry {
  mimeType: string;
  bytes: Buffer;
  expiresAt: number;
}

const g = globalThis as typeof globalThis & { __openlenMcpCaptures?: Map<string, Entry> };
const store = (g.__openlenMcpCaptures ??= new Map<string, Entry>());

export function storeCapture(image: { mimeType: string; dataBase64: string }, now: number = Date.now()): string {
  for (const [k, e] of store) if (e.expiresAt <= now) store.delete(k);
  while (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value!);
  const id = crypto.randomBytes(32).toString("base64url");
  store.set(id, { mimeType: image.mimeType, bytes: Buffer.from(image.dataBase64, "base64"), expiresAt: now + CAPTURE_TTL_MS });
  return id;
}

export function getCapture(id: string, now: number = Date.now()): { mimeType: string; bytes: Buffer } | null {
  const e = store.get(id);
  if (!e) return null;
  if (e.expiresAt <= now) {
    store.delete(id);
    return null;
  }
  return { mimeType: e.mimeType, bytes: e.bytes };
}

export function captureUrl(id: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/mcp/capture/${id}`;
}
