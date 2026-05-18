import { existsSync } from "node:fs";
import { join } from "node:path";

/** Locate a Chromium-class browser on the local machine.
 *  Phase 0 dev: Windows users typically have Edge pre-installed.
 *  Production: Hetzner box ships /usr/bin/chromium via apt-get.
 *  Returns undefined to let Puppeteer fall back to its bundled binary. */
export function findChromeExecutable(): string | undefined {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;

  const localAppData = process.env.LOCALAPPDATA;
  const candidates: string[] = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    ...(localAppData
      ? [join(localAppData, "Google\\Chrome\\Application\\chrome.exe")]
      : []),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
