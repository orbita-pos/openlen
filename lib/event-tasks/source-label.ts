// WHAT AN EVENT TASK WATCHES, AS WORDS (spec local 2026-11-03-len-que-avisa, §7.8; 2026-11-04-hazlo, §7.4): one
// translation key of `eventTasks` and its values, for the web's clock (components/workspace-v2/chat/scheduled-tasks-menu)
// and the phone's «Tareas» (movil/src/overview/tasks-tab). Pure: no server code, both clients import it.
export interface SourceLabel {
  readonly key: string;
  readonly values?: Record<string, string>;
}

export function sourceLabel(task: { readonly source: string; readonly params?: Readonly<Record<string, unknown>> | null }): SourceLabel {
  const p = task.params ?? {};
  const text = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : typeof p[k] === "number" ? String(p[k]) : "");
  switch (task.source) {
    case "app_rows":
      return text("after_hours") ? { key: "sourceRowsAfter", values: { table: text("table"), hours: text("after_hours") } } : { key: "sourceRows", values: { table: text("table") } };
    case "app_users":
      return { key: "sourceAppUsers" };
    case "visitor_chat":
      return { key: p.watch === "signups" ? "sourceChatSignups" : "sourceChatMessages" };
    default:
      return text("form") ? { key: "sourceForm", values: { form: text("form") } } : { key: "sourceAllForms" };
  }
}
