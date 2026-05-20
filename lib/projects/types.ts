// The shape of a project's `data` JSONB column.
//
// Every project — AI-generated, template-clone, or pasted — is a single
// self-contained HTML document. The preview iframe renders `html`;
// `publishProject` writes it to disk verbatim. There is no orchestrator
// envelope (blocks / slots / cost / images) anymore: generation is free-form.
export interface ProjectData {
  /** The complete standalone HTML document. */
  html: string;
}
