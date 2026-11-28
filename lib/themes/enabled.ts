// THE WORKSPACE'S THEMES (spec local 2026-11-27-temas-del-workspace, §7): on by default, like the rest of OpenLen's
// features; only the literal "0" turns them off everywhere — the layer behind the workspace, the Temas section, Len's
// skill and `set_theme`, and the routes (404). The rows stay.
export function themesEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_THEMES !== "0";
}
