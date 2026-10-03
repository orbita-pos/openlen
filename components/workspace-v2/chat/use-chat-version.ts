"use client";

// QUÉ CHAT SE MONTA: el nuevo o el de antes (plans/new-chat/). Desde el 03/10 el
// nuevo es el de POR DEFECTO (decisión de Jesús, tras verlo en el taller con un
// turno de verdad). El viejo se queda una versión detrás de `?chat=old` por si
// acaso, y después se borra junto con este interruptor.
//
// `?chat=old` vuelve al de antes y `?chat=new` al nuevo; se recuerda en este
// navegador (`ol:chat`) para no tener que repetirlo en cada URL. Mismo patrón
// que `ol:agent` (el chat clásico como vía de escape).

import { useEffect, useState, useSyncExternalStore } from "react";

export type ChatVersion = "old" | "new";

/** El chat de por defecto: el nuevo desde el 03/10. */
export const DEFAULT_CHAT_VERSION: ChatVersion = "new";

const STORAGE_KEY = "ol:chat";

export function readChatVersion(search: string, stored: string | null): ChatVersion {
  const param = new URLSearchParams(search).get("chat");
  if (param === "new" || param === "old") return param;
  if (stored === "new" || stored === "old") return stored;
  return DEFAULT_CHAT_VERSION;
}

export function useChatVersion(): ChatVersion {
  const [version, setVersion] = useState<ChatVersion>(DEFAULT_CHAT_VERSION);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Almacenamiento bloqueado: manda la URL o el de por defecto.
    }
    const next = readChatVersion(window.location.search, stored);
    const param = new URLSearchParams(window.location.search).get("chat");
    if (param === "new" || param === "old") {
      try {
        window.localStorage.setItem(STORAGE_KEY, param);
      } catch {
        // Sin almacenamiento sólo vale para esta carga.
      }
    }
    setVersion(next);
  }, []);
  return version;
}

const WIDTH_KEY = "ol:chat-width";
export const CHAT_WIDTH_DEFAULT = 400;
export const CHAT_WIDTH_MIN = 320;
export const CHAT_WIDTH_MAX = 640;

export function clampChatWidth(w: number): number {
  if (!Number.isFinite(w)) return CHAT_WIDTH_DEFAULT;
  return Math.round(Math.min(CHAT_WIDTH_MAX, Math.max(CHAT_WIDTH_MIN, w)));
}

/** El ancho del chat nuevo, que se estira desde su borde y se recuerda. */
export function useChatWidth(): [number, (w: number) => void] {
  const [width, setWidth] = useState(CHAT_WIDTH_DEFAULT);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(WIDTH_KEY));
      if (v) setWidth(clampChatWidth(v));
    } catch {
      // Sin almacenamiento, el ancho de siempre.
    }
  }, []);
  const set = (w: number) => {
    const next = clampChatWidth(w);
    setWidth(next);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Se pierde al recargar; no pasa nada.
    }
  };
  return [width, set];
}

// ─────────────────────────────────────────────────────────────────────────────
// ANCLADO, FLOTANTE O MINIMIZADO (plans/new-chat/, del mock). El chat flotante
// NO se monta en otro sitio: sigue en la barra lateral y sólo cambia su caja
// con CSS (`position: fixed`). Moverlo de sitio en el árbol lo desmontaría, y
// con él se irían el Deshacer y el «comparar» de los turnos de esta pestaña,
// que sólo viven en memoria. Lo comparten la barra lateral y el panel, así que
// vive en un almacén de módulo, recordado en este navegador.
// ─────────────────────────────────────────────────────────────────────────────

export type ChatLayout = "docked" | "floating" | "minimized";

const LAYOUT_KEY = "ol:chat-layout";
const layoutListeners = new Set<() => void>();
let layoutValue: ChatLayout | null = null;

function readLayout(): ChatLayout {
  if (layoutValue) return layoutValue;
  try {
    const v = window.localStorage.getItem(LAYOUT_KEY);
    layoutValue = v === "floating" || v === "minimized" ? v : "docked";
  } catch {
    layoutValue = "docked";
  }
  return layoutValue;
}

export function setChatLayout(next: ChatLayout): void {
  layoutValue = next;
  try {
    window.localStorage.setItem(LAYOUT_KEY, next);
  } catch {
    // Sólo para esta carga.
  }
  layoutListeners.forEach((l) => l());
}

export function useChatLayout(): ChatLayout {
  return useSyncExternalStore(
    (l) => {
      layoutListeners.add(l);
      return () => {
        layoutListeners.delete(l);
      };
    },
    readLayout,
    () => "docked",
  );
}

/** La caja del chat flotante: dónde y de qué tamaño. */
export interface FloatBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const FLOAT_KEY = "ol:chat-float";

export function defaultFloatBox(vw: number, vh: number): FloatBox {
  const w = Math.min(400, vw - 32);
  const h = Math.min(640, vh - 96);
  return { x: Math.max(16, vw - w - 24), y: Math.max(64, vh - h - 24), w, h };
}

/** Que la caja quepa en la ventana: nunca fuera, nunca diminuta. */
export function fitFloatBox(b: FloatBox, vw: number, vh: number): FloatBox {
  const w = Math.min(Math.max(320, b.w), Math.max(320, vw - 16));
  const h = Math.min(Math.max(360, b.h), Math.max(360, vh - 16));
  const x = Math.min(Math.max(8, b.x), Math.max(8, vw - w - 8));
  const y = Math.min(Math.max(8, b.y), Math.max(8, vh - h - 8));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function useFloatBox(): [FloatBox | null, (b: FloatBox) => void] {
  const [box, setBox] = useState<FloatBox | null>(null);
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let stored: FloatBox | null = null;
    try {
      const raw = window.localStorage.getItem(FLOAT_KEY);
      if (raw) stored = JSON.parse(raw) as FloatBox;
    } catch {
      stored = null;
    }
    setBox(fitFloatBox(stored ?? defaultFloatBox(vw, vh), vw, vh));
    // Si la ventana cambia de tamaño, la caja se vuelve a encajar: si no, al
    // estrecharla el chat flotante se quedaba medio fuera de la pantalla.
    const refit = () => setBox((b) => (b ? fitFloatBox(b, window.innerWidth, window.innerHeight) : b));
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);
  const set = (b: FloatBox) => {
    const next = fitFloatBox(b, window.innerWidth, window.innerHeight);
    setBox(next);
    try {
      window.localStorage.setItem(FLOAT_KEY, JSON.stringify(next));
    } catch {
      // Se pierde al recargar.
    }
  };
  return [box, set];
}
