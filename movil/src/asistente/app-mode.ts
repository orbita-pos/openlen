// WHICH ASSISTANT THE APP IS (spec local 2026-11-16-movil-es-tu-asistente, §5.1): Len móvil is the app of your own
// assistant. With one, it is her; with several, the one chosen on this phone (or the newest of your pages); with none, the welcome
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
  /** Her person's assistants were read (final review, I6): until then — or if the read failed — an empty list is not
   *  «none», and the welcome must not cover the app of someone who has one. */
  readonly loaded: boolean;
  readonly enabled: boolean;
  /** Newest first, as `GET /api/assistants` gives them. */
  readonly assistants: readonly AssistantListItem[];
  readonly chosenId: string | null;
  readonly projects: readonly ProyectoEnLista[];
  readonly welcomeDismissed: boolean;
}): AppMode {
  if (!o.loaded || !o.enabled) return { kind: "len", invite: false };
  // None chosen on this phone: the newest that attends one of your pages, else the newest. An agent made on the web lives
  // in your space and attends none (spec local 2026-11-19-agentes-para-todos, §6.10): it doesn't take her place.
  const ofYourPages = o.assistants.find((a) => a.projectIds.some((id) => o.projects.some((p) => p.id === id)));
  const chosen = o.assistants.find((a) => a.id === o.chosenId) ?? ofYourPages ?? o.assistants[0];
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
