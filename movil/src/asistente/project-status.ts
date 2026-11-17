// A PROJECT AND HER (spec local 2026-11-16-movil-es-tu-asistente, §5.6): in her app, Len's chat is gone from the
// phone, so a project she doesn't serve can't be changed from it — unless she takes it. Hers; yours and free (she can
// take it); yours with another of your assistants (switch to her); or someone else's, shared with you (only to look:
// giving it an assistant is its owner's).
import type { AssistantListItem } from "@/lib/assistants/view";

import type { ProyectoEnLista } from "../api/proyectos";

export type ProjectStatus =
  | { readonly kind: "hers" }
  | { readonly kind: "free" }
  | { readonly kind: "other"; readonly assistant: AssistantListItem }
  | { readonly kind: "notYours" };

export function projectStatusOf(project: ProyectoEnLista, her: AssistantListItem, all: readonly AssistantListItem[]): ProjectStatus {
  if (project.compartido) return { kind: "notYours" };
  if (her.projectIds.includes(project.id)) return { kind: "hers" };
  const other = all.find((a) => a.id !== her.id && a.projectIds.includes(project.id));
  return other ? { kind: "other", assistant: other } : { kind: "free" };
}
