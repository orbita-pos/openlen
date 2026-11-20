// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2): one hidden project per person where their agents
// live, as Claude Code's agents work in the person's folder. It is marked in the project's `data`, like `data.app`,
// `data.tool` and `data.game`; it is never listed, published, converted, shared or attended by visitors.
//
// Pure and client-safe.

export interface SpaceOfProject {
  readonly bornAt: string;
}

/** Whether a project's `data` is a space's. */
export function isSpaceData(data: { space?: unknown } | null | undefined): boolean {
  const space = data?.space;
  return typeof space === "object" && space !== null;
}
