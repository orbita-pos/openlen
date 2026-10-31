import type { StoredChatTurn } from "@/lib/projects/types";
import { claveDeAvance } from "../chat/hilo";

export type Paso = { texto?: string; clave?: string; estado: "running" | "done" | "pending" | "error" | "warning" };
export function pasosDelTrabajo(todas: NonNullable<StoredChatTurn["actions"]>): Paso[] {
  // A red step Len got past, with nothing in it for the owner (no `ownerReason`), isn't the owner's to look at: Len
  // handled it (a real incident, 31/10: an `ls tests` with no tests exited 2 and the phone said «needs attention»).
  // It's left out, not shown as done. The last step and the amber ones (notices for the owner) stay.
  const acciones = todas.filter((a, i) => !(a.status === "error" && !a.ownerReason && i < todas.length - 1));
  const lista = [...acciones].reverse().find((a) => a.todos)?.todos;
  const fallos = acciones.filter((a) => a.status === "error" || a.status === "warning").map((a): Paso => ({ clave: claveDeAvance(a.tool) ?? "trabajando", estado: a.status === "error" ? "error" : "warning" }));
  if (lista) return [...lista.map((t): Paso => ({ texto: t.content, estado: t.status === "completed" ? "done" : t.status === "in_progress" ? "running" : "pending" })), ...fallos];
  const visibles = acciones.filter((a) => a.tool !== "todo_write" && a.tool !== "ask_user_question" && a.tool !== "preguntar");
  return visibles.filter((a, i) => a.status === "error" || a.status === "warning" || i >= visibles.length - 6).map((a) => ({ clave: claveDeAvance(a.tool) ?? "trabajando", estado: a.status === "error" || a.status === "warning" || a.status === "running" ? a.status : "done" }));
}
