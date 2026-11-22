// THE PROJECT ON HER OWNER'S PHONE (spec local 2026-11-16-movil-es-tu-asistente, §5.3, §5.8.2): the phone's main
// screen is a project with her sheet over it, so her turn knows which one the owner is looking at. One line in her
// turn's context — never in the system prompt, so the cache stays — and `ask_len`'s default when she serves several.

export interface ViewingProject {
  readonly id: string;
  readonly title: string;
  /** Whether she serves it: only then can a request go there. */
  readonly served: boolean;
  /** One it STARTED (spec local 2026-11-21-agente-sigue-su-proyecto): not served, but its to follow — a request that
   *  names no project goes there too. */
  readonly started?: true;
}

export function viewingLine(v: ViewingProject): string {
  if (v.started) return `Your owner is looking at «${v.title}» (${v.id}) on their phone, a project you started. A request that names no project goes to it.`;
  // Someone else's project, shared with the owner: she learns it isn't hers, never its name (final review, I4).
  if (!v.served && !v.title) return "Your owner is looking at a project you don't serve on their phone: you can't pass requests for it to Len.";
  return v.served
    ? `Your owner is looking at «${v.title}» (${v.id}) on their phone. A request that names no project goes to it.`
    : `Your owner is looking at «${v.title}» on their phone, a project you don't serve: you can't pass requests for it to Len. Their phone shows them a button to let you serve it.`;
}
