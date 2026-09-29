/**
 * TODOWRITE, como Claude Code (H2 de Len 2.x, 2026-09-25). Sustituye a
 * `declarar_tareas`.
 *
 * Nombre, esquema y funcionamiento como los de Claude Code: es lo que el
 * modelo ya sabe usar. Los textos que lee (descripción, respuesta y
 * recordatorio) están escritos con palabras nuestras (2026-09-27), con
 * ejemplos de páginas web.
 *
 * Lo que sigue siendo NUESTRO, dicho en voz alta: la lista pasa por la
 * EVIDENCIA (`lib/agent/lista-de-tareas.ts`) —una tarea no se da por
 * «completed» si mientras estaba en curso no cambió nada—. Claude Code no lo
 * hace; aquí se conserva porque lo que cierra es un fallo medido (H02 de la
 * auditoría del 2026-09-22). Pero no se mezcla con la respuesta: el
 * `tool_result` va limpio, y el aviso viaja en el mensaje hermano, en un
 * `<system-reminder>`, como los diagnósticos.
 *
 * Cada línea del recordatorio es `N. [status] content`.
 */
import type { EstadoDeTarea, TareaDeclarada } from "@/lib/agent/lista-de-tareas";

export const NOMBRE_TODO_WRITE = "TodoWrite";

const DESCRIPCION = `Keeps a task list for the job you are doing on this website. The user sees it, so it tells them where you are, and it keeps you from leaving part of their request undone.

Use it on your own initiative, without waiting to be asked, when:
- The request has three or more distinct steps, or touches several pages (for example: "add a Contact page, link it from the menu and put the new phone number in the footer").
- The job is not trivial: it needs some planning or several operations, even if the user asked for it in one line.
- The user asks for several things in one message, numbered or separated by commas, or asks you to keep a list.
- New instructions arrive in the middle of the work: add them as tasks straight away.

Do not use it when:
- There is a single small change ("make the title bigger", "change the phone number").
- The job takes fewer than three easy steps, so a list would organise nothing.
- It is a question or a conversation, with nothing to build.
In those cases just do the job.

How to keep it:
- Each task has a status: pending (not started), in_progress (being done now) or completed (done).
- Exactly ONE task is in_progress while you work: never none, never two. Set it to in_progress BEFORE you start on it, and finish it before you start another.
- Update the list as you go. Mark each task completed the MOMENT it is done; do not leave them all for the end.
- A task is completed ONLY when it is fully done and the page works as asked. It is NOT completed if part of it is missing, if an error is still unsolved, or if you could not find the page, the section or the data it needs. If you are stuck, leave it in_progress and add a task that says what is blocking it.
- Add the tasks you discover on the way, and remove the ones that stop making sense.
- Write concrete tasks, small enough to act on, whose names say clearly what changes. Split a big job into steps.
- Each task is ALWAYS written in two forms: content says what to do ("Add the Contact page") and activeForm what is happening while it runs ("Adding the Contact page").

Examples of when to use it:

User: "Make me three pages, Home, Menu and Contact, with the same header and footer, and the WhatsApp button on all of them. Then check they look right on a phone."
Assistant: creates the list (Home page; Menu page; Contact page; same header and footer on the three; WhatsApp button on each page; check the three pages on a phone) and starts with the first.
Why: several pages, and a change that has to reach all of them. The list keeps a page from being forgotten. Every task comes from the request, the phone check included: the owner asked for it at the end.

User: "We changed our name from Café Luna to Luna Tostadores, update it on the site."
Assistant: first searches with Grep and finds the old name 11 times across 4 pages, the page titles and the footer included. Then creates one task per page and goes through them.
Why: searching first showed how big the job was. With one task per page, no copy of the old name is left behind.

User: "I need a booking form, a price list, a photo gallery and a map to find us."
Assistant: creates a list with one task per part, split where needed (for the form: its fields, where the bookings arrive, the message the customer sees after sending), and starts with the form.
Why: several things asked at once, separated by commas. The list turns a long request into steps that can be ticked off.

User: "On the phone the page feels slow and cluttered. Can you improve it?"
Assistant: first looks at the page on a phone and reads it, then lists what it found (a hero image that is too heavy, a menu that does not fold, three sections that say the same thing, a button that overflows) and works through the list.
Why: the request was open. Looking first turned it into concrete tasks, and the list makes sure every problem found gets fixed.

Examples of when not to use it:

User: "The croissant now costs 2.50."
Assistant: finds the price with Grep, changes it with Edit wherever it appears, and says so. No list.
Why: one change, even if it appears in two places. A list adds nothing.

User: "Make the title of the home page bigger."
Assistant: changes the size with Edit and says so. No list.
Why: one change, in one place of one page.

User: "What does the Publish button do?"
Assistant: answers. No list.
Why: it is a question; there is nothing to build.

User: "Is my page published already?"
Assistant: checks and answers. No list.
Why: a question with a direct answer; there are no steps to follow.

When in doubt, use it. Keeping the list is how the user sees that you are taking care of every part of what they asked, and how you make sure you finish all of it.`;

export const DECLARACION_TODO_WRITE: Record<string, unknown> = {
  name: NOMBRE_TODO_WRITE,
  description: DESCRIPCION,
  parameters: {
    type: "OBJECT",
    properties: {
      todos: {
        type: "ARRAY",
        description: "The whole list, as it should be after this change",
        items: {
          type: "OBJECT",
          properties: {
            content: { type: "STRING" },
            status: { type: "STRING", enum: ["pending", "in_progress", "completed"] },
            activeForm: { type: "STRING" },
          },
          required: ["content", "status", "activeForm"],
        },
      },
    },
    required: ["todos"],
  },
};

export const RESULTADO_TODO_WRITE =
  "List saved. Keep it up to date as you work, and carry on with the task in progress.";

export const RECORDATORIO_TODO_WRITE =
  "You have not updated the task list (TodoWrite) for a while. If the job has several steps, use it to keep track of them; if the list is out of step with what you are doing now, tidy it up. If it does not fit this work, ignore this reminder.";

const DE_CC: Record<string, EstadoDeTarea> = { pending: "pendiente", in_progress: "en_curso", completed: "hecha" };
const A_CC: Record<EstadoDeTarea, string> = { pendiente: "pending", en_curso: "in_progress", hecha: "completed" };

/** Los `todos` de TodoWrite como las tareas de la lista. */
export function leerTodos(
  args: Record<string, unknown>,
): { readonly ok: true; readonly tareas: TareaDeclarada[] } | { readonly ok: false; readonly error: string } {
  const todos = args.todos;
  if (!Array.isArray(todos)) {
    return { ok: false, error: "<tool_use_error>InputValidationError: `todos` is required and was not sent</tool_use_error>" };
  }
  const tareas: TareaDeclarada[] = [];
  for (const t of todos) {
    if (!t || typeof t !== "object") continue;
    const o = t as Record<string, unknown>;
    const content = typeof o.content === "string" ? o.content.trim() : "";
    if (!content) continue;
    const estado = typeof o.status === "string" ? DE_CC[o.status] : undefined;
    tareas.push({ texto: content, ...(estado ? { estado } : {}) });
  }
  return { ok: true, tareas };
}

/** El recordatorio, con la lista delante. */
export function recordatorioTodoWrite(lineas: readonly { texto: string; estado: EstadoDeTarea }[]): string {
  const lista = lineas.map((l, i) => `${i + 1}. [${A_CC[l.estado]}] ${l.texto}`).join("\n");
  return `<system-reminder>\n${RECORDATORIO_TODO_WRITE}\n\nThe list as it is now:\n\n[${lista}]\n</system-reminder>`;
}
