// WHICH BROWSER THE WINDOW OF AN APP ON THE DESKTOP IS IN (spec local 2026-11-26-apps-en-el-escritorio, §4.3), for the card that
// says exactly where to install it. Claude writes the shortcut itself and says where the app went («Open it from the Start menu
// or your desktop»); a PWA's shortcut is the browser's, so the steps are the browser's: Chrome and Edge have an install icon and a
// menu entry, Safari on a Mac has «Add to Dock», Firefox can't install an app on a computer at all. Anything else — Opera,
// Samsung Internet, a phone's browser (its install is the phone's), a user agent that says nothing — gets the generic text.
// Pure: the user agent is the caller's.

export type InstallBrowser = "chrome" | "edge" | "safari" | "firefox" | "other";

export function installBrowser(userAgent: string): InstallBrowser {
  const ua = userAgent ?? "";
  // A phone or tablet installs through its own menu, and the steps here are a computer's.
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return "other";
  // Other browsers that also say «Chrome» or «Safari»: not told apart here, so not given steps that may be wrong.
  if (/OPR\/|Opera|SamsungBrowser|UCBrowser/i.test(ua)) return "other";
  // Edge says «Chrome» too: it goes first.
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\/|FxiOS\//.test(ua)) return "firefox";
  if (/Chrome\/|Chromium\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua) && /Macintosh|Mac OS X/.test(ua)) return "safari";
  return "other";
}
