// «AHORA NO» ON THE WINDOW'S INSTALL CARD (spec local 2026-11-26-apps-en-el-escritorio, §4.3): remembered per app in this browser,
// so the card does not ask again on every open (Claude has no card that can be dismissed: install is a menu entry the person
// picks). It is a convenience only — every read and write is guarded, and the card works without storage.
const keyOf = (desktopId: string) => `openlen:desktop-install-later:${desktopId}`;

export function installCardDismissed(desktopId: string): boolean {
  try {
    return window.localStorage.getItem(keyOf(desktopId)) === "1";
  } catch {
    return false;
  }
}

export function dismissInstallCard(desktopId: string): void {
  try {
    window.localStorage.setItem(keyOf(desktopId), "1");
  } catch {
    // The card is hidden for this visit; it may ask again on the next.
  }
}
