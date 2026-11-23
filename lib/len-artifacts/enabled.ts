// LEN'S ARTIFACTS (spec local 2026-11-22-artifacts-de-len): on by default, like the rest of OpenLen's features; only
// the literal "0" turns it off everywhere — `publish_artifact`, `artifact_data`, and the `artifact` parameter on
// `view_page`/`use_page` are omitted from declarations and refused if called, serving answers 404, and the web and
// phone UI hide the artifact surfaces.
export function lenArtifactsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_LEN_ARTIFACTS !== "0";
}
