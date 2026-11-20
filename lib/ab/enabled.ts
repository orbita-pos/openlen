// Feature gate for OpenLen Edge A/B Testing (Plan 3).
// Opt-in during initial rollout (`OPENLEN_AB_TESTING=1`): when unset or != "1",
// no A/B evaluator runs, no A/B controls or Len tools are exposed, and publish
// never emits ab.json.
export function abTestingEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.OPENLEN_AB_TESTING === "1";
}
