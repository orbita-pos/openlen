/**
 * THE DOCUMENT OF A VISUAL'S FRAME (local spec 2026-10-16-len-inline-visuals, §4.3).
 *
 * Served by `/api/visual-frame` on `lienzo-visuals.<lienzo domain>` with the
 * CSP in a header, or put in a `srcdoc` (the fallback where there is no
 * isolated host) with the CSP in a meta tag. It holds nothing of the user's: the
 * chat sends it the code and the workspace colors by `postMessage`.
 *
 * Pure: the chat imports it for the `srcdoc` fallback.
 */
import { FRAME_RUNTIME_JS } from "./frame-runtime";

export const VISUALS_CDN_ORIGINS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
] as const;

/** The `lucide-react` version of package.json: the icons match the workspace's.
 *  Checked 2026-10-16: the CSS exists on jsdelivr and its classes are `.icon-<name>`. */
export const LUCIDE_FONT_VERSION = "1.16.0";

const GOOGLE_FONT_STYLES = "https://fonts.googleapis.com";
const GOOGLE_FONT_FILES = "https://fonts.gstatic.com";

export function visualFrameCsp(frameAncestors: string | null): string {
  const cdns = VISUALS_CDN_ORIGINS.join(" ");
  const directives = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cdns}`,
    `style-src 'unsafe-inline' ${cdns} ${GOOGLE_FONT_STYLES}`,
    `font-src ${cdns} ${GOOGLE_FONT_FILES} data:`,
    `img-src data: blob: ${cdns}`,
    `connect-src ${cdns}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "worker-src blob:",
  ];
  if (frameAncestors) directives.push(`frame-ancestors ${frameAncestors}`);
  return directives.join("; ");
}

/** Defaults of the variables the manual names (`VISUAL_TOKENS`). The workspace
 *  ones copy `app/[locale]/new/tokens.css`; the chat overrides them with the
 *  values it resolves, so these only show before its first message. */
const LIGHT = `
  --bg: oklch(97.2% 0.004 12);
  --bg-elev: oklch(99.2% 0.003 12);
  --fg: oklch(15% 0.01 12);
  --fg-muted: oklch(45% 0.01 12);
  --fg-faint: oklch(48% 0.01 12);
  --border: oklch(85% 0.005 12 / 0.6);
  --border-strong: oklch(78% 0.005 12 / 0.8);
  --accent: #FF5A36;
  --accent-soft: oklch(94.2% 0.045 30);
  --accent-strong: #D63916;
  --hover: oklch(93.2% 0.006 12);
  --success: #15803d;
  --warning: #b45309;
  --danger: #dc2626;
  --series-1: #FF5A36;
  --series-2: #2563eb;
  --series-3: #059669;
  --series-4: #d97706;
  --series-5: #7c3aed;
  --series-6: #db2777;
  --radius: 8px;
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;`;

const DARK = `
  --bg: oklch(11% 0.01 12);
  --bg-elev: oklch(15% 0.01 12);
  --fg: oklch(96% 0.005 12);
  --fg-muted: oklch(65% 0.01 12);
  --fg-faint: oklch(64% 0.01 12);
  --border: oklch(25% 0.01 12 / 0.7);
  --border-strong: oklch(32% 0.01 12 / 0.9);
  --accent-soft: oklch(28% 0.07 30);
  --hover: oklch(18% 0.01 12);
  --success: #4ade80;
  --warning: #fbbf24;
  --danger: #f87171;
  --series-1: #ff7a5c;
  --series-2: #60a5fa;
  --series-3: #34d399;
  --series-4: #fbbf24;
  --series-5: #a78bfa;
  --series-6: #f472b6;`;

const STYLE = `
:root {${LIGHT}
  color-scheme: light;
}
:root[data-theme="dark"] {${DARK}
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body { color: var(--fg); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; overflow: hidden; }
#root { display: flow-root; overflow-wrap: anywhere; }
a { color: var(--accent); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button { font: inherit; font-size: 13px; color: var(--fg); background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 6px 12px; cursor: pointer; }
button:hover { background: var(--hover); }
button:active { transform: scale(0.98); }
input, select, textarea { font: inherit; font-size: 13px; color: var(--fg); background: var(--bg-elev); border: 1px solid var(--border-strong); border-radius: var(--radius); padding: 6px 10px; }
input:focus, select:focus, textarea:focus, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
input[type="range"] { padding: 0; border: 0; background: transparent; accent-color: var(--accent); }
input[type="checkbox"], input[type="radio"] { accent-color: var(--accent); }`;

export function buildVisualFrameDocument(opts: { readonly parentOrigins: readonly string[]; readonly cspInMeta: boolean }): string {
  const origins = JSON.stringify(opts.parentOrigins).replace(/</g, "\\u003c");
  const meta = opts.cspInMeta ? `<meta http-equiv="Content-Security-Policy" content="${visualFrameCsp(null)}">` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
${meta}
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lucide-static@${LUCIDE_FONT_VERSION}/font/lucide.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&display=swap">
<style>${STYLE}
</style>
</head>
<body>
<div id="root"></div>
<script>${FRAME_RUNTIME_JS.replace("__PARENT_ORIGINS__", origins)}</script>
</body>
</html>`;
}
