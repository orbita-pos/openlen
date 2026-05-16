import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Browser } from "puppeteer";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Puppeteer browser singleton for gates 1 (a11y) + 3 (mobile).
//
// Launching Chromium costs ~700-1200ms cold. Both deterministic puppeteer
// gates run in parallel within `runAllGates`, so reusing one browser instance
// across the two gates cuts wall-clock by ~1s.
//
// Lifecycle: the orchestrator calls `disposeBrowser()` after the gate batch
// finishes (passing OR failing) so the next generation gets a fresh launch.
// We don't keep the browser alive across generations because the Next.js
// dev-server hot-reload would leave orphan chrome processes.
// ─────────────────────────────────────────────────────────────────────────────

let cached: Browser | null = null;
let launching: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (cached) return cached;
  if (launching) return launching;
  launching = launch();
  try {
    cached = await launching;
    return cached;
  } finally {
    launching = null;
  }
}

async function launch(): Promise<Browser> {
  // Avoid eager import — gates module loads in serverless paths that may
  // never need a browser (e.g. listing existing projects).
  const puppeteer = (await import("puppeteer")).default;
  return puppeteer.launch({
    headless: true,
    executablePath: resolveChromePath(),
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      // Reduce non-essential overhead during a single setContent + evaluate.
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--disable-translate",
      "--metrics-recording-only",
      "--mute-audio",
      "--no-first-run",
    ],
  });
}

export async function disposeBrowser(): Promise<void> {
  const current = cached;
  cached = null;
  if (current) {
    try {
      await current.close();
    } catch {
      // Browser may already be dead — that's fine, we're disposing.
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Locate a Chrome executable Puppeteer can drive.
//
// Strategy:
//   1. PUPPETEER_EXECUTABLE_PATH env var (escape hatch for CI / docker).
//   2. The newest version under ~/.cache/puppeteer/chrome — `npx puppeteer
//      browsers install chrome` writes here. We do this before falling back
//      to the bundled binary because in MOCK_MODE we install with
//      PUPPETEER_SKIP_DOWNLOAD=true; the bundled-binary path is empty.
//   3. Let puppeteer pick its bundled binary (returns undefined → default).
// ─────────────────────────────────────────────────────────────────────────────

function resolveChromePath(): string | undefined {
  const env = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (env && existsSync(env)) return env;

  const cacheDir = path.join(os.homedir(), ".cache", "puppeteer", "chrome");
  if (!existsSync(cacheDir)) return undefined;

  const versions = readdirSync(cacheDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("win64-"))
    .map((d) => d.name)
    .sort()
    .reverse();

  for (const v of versions) {
    const candidate = path.join(cacheDir, v, "chrome-win64", "chrome.exe");
    if (existsSync(candidate)) return candidate;
    const linuxCandidate = path.join(cacheDir, v, "chrome-linux64", "chrome");
    if (existsSync(linuxCandidate)) return linuxCandidate;
  }
  return undefined;
}
