// lib/security/chromium-env.ts — WHAT THE SERVER'S CHROMIUM INHERITS (2026-10-20).
//
// Every Chromium the server launches runs JavaScript nobody here wrote: the
// pages and apps the model writes (Len's eyes, an app's `npm test`, thumbnails,
// the og-card, the Flight Check) and, for style-match, another site's. Some
// launchers still pass `--no-sandbox`, and even with Chrome's sandbox on (the
// eyes', since 2026-10-20) the GPU process that runs WebGL is not sandboxed.
// Puppeteer's default `env` is all of `process.env`, and the server's holds
// DATABASE_URL, AUTH_SECRET and every provider key: an exploit in an
// unsandboxed process would find them one read of /proc/<pid>/environ away.
//
// Chromium needs none of them, so it gets an ALLOWLIST: where its binaries,
// fonts and temp files are, the locale and the time zone. Not a denylist of
// secret-looking names: the next key added to the server would walk through
// it, and Chrome itself reads some secret-shaped variables (GOOGLE_API_KEY).
// Proxy variables stay out as well: the egress proxy goes in as a flag
// (`isolatedNetworkArgs`), and a proxy URL can carry a password.

/** Names as POSIX spells them (case-sensitive there). `LC_*` passes too. */
const POSIX: readonly string[] = ["PATH", "TZ", "LANG", "LANGUAGE", "TMPDIR", "FONTCONFIG_FILE", "FONTCONFIG_PATH"];

/** What a Windows process needs to start (development machines): without
 *  SystemRoot it can't even open a socket. Matched case-insensitively, as
 *  Windows does. None of these holds a secret. */
const WINDOWS: readonly string[] = [
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "COMSPEC",
  "PATHEXT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
];

/** The `env` for every `puppeteer.launch` that renders HTML we didn't write. */
export function chromiumEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const windows = platform === "win32";
  const fold = (name: string) => (windows ? name.toUpperCase() : name);
  const allowed = new Set([...POSIX, ...(windows ? WINDOWS : [])].map(fold));
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const key = fold(name);
    if (allowed.has(key) || key.startsWith("LC_")) env[name] = value;
  }
  // The service's HOME is read-only (ProtectHome=read-only in
  // infra/app/openlen-app.service) and Chrome's bootstrap writes under it;
  // without this it dies before launching (measured 2026-05-28).
  env.HOME = "/tmp";
  return env;
}
