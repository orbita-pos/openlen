// WHICH ASSISTANT THE APP IS (spec local 2026-11-16-movil-es-tu-asistente, §5.1): Len móvil is the app of your own
// assistant. With one, it is her; with several, the one chosen on this phone (or the newest); with none, the welcome
// creates her. Today's app, with Len, is the safety net: assistants off on the server, no project of your own to be
// her home, or the welcome dismissed (then the sheet invites you to meet her).
import type { AssistantListItem } from "@/lib/assistants/view";

import type { ProyectoEnLista } from "../api/proyectos";

export const CHOSEN_KEY = "len-asistente";
export const WELCOME_DISMISSED_KEY = "len-bienvenida";

export type AppMode =
  | { readonly kind: "assistant"; readonly assistant: AssistantListItem }
  | { readonly kind: "welcome" }
  | { readonly kind: "len"; readonly invite: boolean };

export function appModeOf(o: {
  readonly enabled: boolean;
  /** Newest first, as `GET /api/assistants` gives them. */
  readonly assistants: readonly AssistantListItem[];
  readonly chosenId: string | null;
  readonly projects: readonly ProyectoEnLista[];
  readonly welcomeDismissed: boolean;
}): AppMode {
  if (!o.enabled) return { kind: "len", invite: false };
  const chosen = o.assistants.find((a) => a.id === o.chosenId) ?? o.assistants[0];
  if (chosen) return { kind: "assistant", assistant: chosen };
  const ownsOne = o.projects.some((p) => !p.compartido);
  if (!ownsOne) return { kind: "len", invite: false };
  return o.welcomeDismissed ? { kind: "len", invite: true } : { kind: "welcome" };
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage: it holds for this time */
  }
}

export const readChosen = (): string | null => read(CHOSEN_KEY);
export const saveChosen = (id: string): void => write(CHOSEN_KEY, id);
export const readWelcomeDismissed = (): boolean => read(WELCOME_DISMISSED_KEY) === "1";
export const dismissWelcome = (): void => write(WELCOME_DISMISSED_KEY, "1");
