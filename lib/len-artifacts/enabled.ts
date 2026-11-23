// THE TOOL THAT LIVES INSIDE AN AGENT (spec local 2026-11-22-herramienta-dentro-del-agente): on by default, like the rest
// of OpenLen's features; only the literal "0" turns it off everywhere — the agent's `publish_artifact` and `artifact_data` refuse
// (their declarations stay, for the cache), serving answers 404 and the web and phone UI hide the tabs.
export function lenArtifactsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_LEN_ARTIFACTS !== "0";
}
