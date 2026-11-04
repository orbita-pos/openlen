// A TOOL IS INSTALLED, NOT PUBLISHED (spec local 2026-11-04-herramientas-hechas-por-len, §4.2): `publishProject`
// throws this for a project born as a tool; the gates answer it as 409 `tool_installs`.
export class ProjectIsToolError extends Error {
  constructor() {
    super("A tool project is installed, not published.");
    this.name = "ProjectIsToolError";
  }
}
