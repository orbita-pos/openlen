// THE PERSON'S SPACE (spec local 2026-11-19-agentes-para-todos, §6.2): what its doors throw.

/** `publishProject` throws it for a space; the gates answer 409 `space_never_publishes`. */
export class ProjectIsSpaceError extends Error {
  constructor() {
    super("The person's space is never published.");
    this.name = "ProjectIsSpaceError";
  }
}

/** `deleteProject` throws it for a space where an agent lives; the route answers 409 `space_has_agents`. */
export class SpaceHasAgentsError extends Error {
  constructor() {
    super("The person's space can't be deleted while an agent lives in it.");
    this.name = "SpaceHasAgentsError";
  }
}
