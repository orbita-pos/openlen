// APPS ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §6): on by default, like the rest of OpenLen's
// features; only the literal "0" turns them off — the Publicar menu's button goes away and `/desktop/*` answers 404.
export function desktopAppsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_DESKTOP_APPS !== "0";
}
