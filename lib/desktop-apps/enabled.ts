// APPS ON THE DESKTOP (spec local 2026-11-26-apps-en-el-escritorio, §6): on by default, like the rest of OpenLen's
// features; only the literal "0" turns them off — the Publicar menu's button goes away and `/desktop/*` answers 404.
export function desktopAppsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_DESKTOP_APPS !== "0";
}

// NOTIFICATIONS OF AN APP ON THE DESKTOP (spec local 2026-11-27-notificaciones-del-escritorio, §7.4): the same rule. With
// OPENLEN_DESKTOP_NOTIFICATIONS=0 the window's API still exists (an app that calls it must not crash) and every permission
// is «unavailable»; whether the apps are on at all is `desktopAppsEnabled`, which this does not look at.
export function desktopNotificationsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OPENLEN_DESKTOP_NOTIFICATIONS !== "0";
}
