// Contract linter — enforces the HARD-LOCKED tier of the OpenLen Design Contract
// (docs/openlen-contract.md) on a single ingredient's HTML. Reports violations;
// callers decide whether to reject (the CLI exits non-zero on any error).
//
// Mechanical floor only: hairline alphas, no raw hex outside :root, single
// accent, token consumption, the required :root tokens (documents), and the
// reserved data-slot-path marker. The SOFT-LOCKED craft + the FREE identity are
// the authoring model's job — a linter can't (and shouldn't) judge taste.
//
// CSS inside <style> is parsed with postcss (accurate); inline style="" and the
// slot-path marker are matched with regex. Tailwind utility classes are NOT
// checked — they resolve via the CDN and `border-white/5` etc. are sanctioned.

import postcss from "postcss";

export type ContractKind = "document" | "section" | "fragment";
export type ContractMode = "dark" | "light" | "cream";

export interface ContractViolation {
  level: "error" | "warning";
  rule: string;
  detail: string;
}

export interface ContractLintResult {
  /** True when there are no `error`-level violations (warnings are allowed). */
  ok: boolean;
  kind: ContractKind;
  violations: ContractViolation[];
}

// Canonical core tokens a full document must declare on :root.
const REQUIRED_TOKENS = [
  "--bg",
  "--surface",
  "--fg",
  "--accent",
  "--radius",
  "--font-display",
  "--font-body",
] as const;

// The full canonical token vocabulary (docs/openlen-contract.md). Anything
// declared on :root outside this set is a non-canonical dialect token — the
// migration target (e.g. Mirror's --hair/--fg-dim, Manuscript's --ink/--rule).
const CANONICAL_TOKENS = new Set([
  "--bg", "--surface", "--surface-2",
  "--fg", "--fg-muted", "--fg-faint",
  "--border", "--border-strong",
  "--accent", "--accent-r", "--accent-ink",
  "--radius", "--radius-sm", "--radius-lg",
  "--font-display", "--font-body", "--font-mono",
  "--warn", "--danger",
]);

// The normalizer writes the same vocabulary under its own reserved `--ol-`
// namespace (crates/html-engine/src/normalize/*, lib/generation/creative-compiler.ts).
// Without this the linter flags every normalized page ~80 times for tokens WE
// wrote, and the real violations drown. The namespace is not blanket-allowed:
// `--ol-background` / `--ol-accentink` are dialect names the adoption pass
// failed to map, and staying flagged is the point.
const OL_MIRRORED = new Set(
  [...CANONICAL_TOKENS].map((name) => `--ol-${name.slice(2)}`),
);
const OL_THEME_EXTRA = new Set(["--ol-r"]);
// Machine-generated scale families: --ol-space-4, --ol-r-2xl, --ol-text-lg,
// --ol-lh-xl, plus the three zoom knobs that drive them.
const OL_SCALE = /^--ol-(?:space|r|text|lh)-(?:scale|[a-z0-9_]+)$/;

function isCanonicalToken(name: string): boolean {
  if (CANONICAL_TOKENS.has(name)) return true;
  if (OL_MIRRORED.has(name) || OL_THEME_EXTRA.has(name)) return true;
  return OL_SCALE.test(name);
}

const COLOR_PROP =
  /^(color|background|background-color|border|border-(?:top|right|bottom|left)-color|border-color|fill|stroke|outline-color)$/i;
const BORDER_PROP = /^(border|border-(?:top|right|bottom|left)?-?color)$/i;
const HEX_G = /#[0-9a-fA-F]{3,8}\b/g;

function styleBlocks(html: string): string {
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1] ?? "");
  return out.join("\n");
}

function isRootSelector(sel: string): boolean {
  // matches `:root` and `:root.dark` (the token-defining selectors)
  return /(^|\s|,):root\b/.test(sel);
}

// Alpha of a neutral white/black rgba literal (the hairline case), else null.
function neutralBorderAlpha(value: string): number | null {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(
    value,
  );
  if (!m) return null;
  const r = Number(m[1]);
  const g = Number(m[2]);
  const b = Number(m[3]);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const neutral = r === g && g === b && (r === 0 || r === 255);
  return neutral ? a : null;
}

function capForMode(
  mode: ContractMode | undefined,
  hasDarkBg: boolean,
  hasLightBg: boolean,
): number {
  if (mode === "dark") return 0.06;
  if (mode === "light" || mode === "cream") return 0.08;
  if (hasDarkBg && !hasLightBg) return 0.06;
  return 0.08; // default looser to avoid false positives
}

export function lintContract(
  html: string,
  opts: { kind?: ContractKind; mode?: ContractMode } = {},
): ContractLintResult {
  const kind: ContractKind =
    opts.kind ?? (/(<!doctype|<html\b)/i.test(html) ? "document" : "fragment");
  const violations: ContractViolation[] = [];
  const err = (rule: string, detail: string) =>
    violations.push({ level: "error", rule, detail });
  const warn = (rule: string, detail: string) =>
    violations.push({ level: "warning", rule, detail });

  // 1. reserved editor marker — must never ship in an ingredient.
  if (/\bdata-slot-path\s*=/.test(html)) {
    err(
      "no-slot-path",
      "data-slot-path= is a reserved editor marker and must not appear in an ingredient.",
    );
  }

  const css = styleBlocks(html);
  const declaredRootVars = new Set<string>();
  let hasDarkBg = false;
  let hasLightBg = false;

  if (css.trim()) {
    let root: postcss.Root | null = null;
    try {
      root = postcss.parse(css);
    } catch {
      warn("css-parse", "Could not parse <style> CSS — CSS checks skipped.");
    }
    if (root) {
      root.walkRules((ruleNode) => {
        const sel = ruleNode.selector;
        if (isRootSelector(sel)) {
          ruleNode.walkDecls((d) => {
            if (!d.prop.startsWith("--")) return;
            declaredRootVars.add(d.prop);
            if (d.prop === "--bg") {
              if (/\.dark/.test(sel)) hasDarkBg = true;
              else hasLightBg = true;
            }
          });
          return; // colors INSIDE :root are where values live — never flagged
        }
        ruleNode.walkDecls((d) => {
          const prop = d.prop.toLowerCase();
          const val = d.value;
          if (prop === "box-shadow") return; // shadows legitimately use rgba(0,0,0,x)
          if (COLOR_PROP.test(prop)) {
            const hexes = val.match(HEX_G);
            if (hexes) {
              err(
                "color-from-token",
                `Hardcoded color ${hexes[0] ?? ""} in "${prop}" — resolve from a token via var(--…).  [${sel}]`,
              );
            }
          }
          if (BORDER_PROP.test(prop)) {
            const a = neutralBorderAlpha(val);
            if (a !== null) {
              const cap = capForMode(opts.mode, hasDarkBg, hasLightBg);
              if (a > cap) {
                warn(
                  "hairline-alpha",
                  `Border alpha ${a} exceeds the hairline cap ${cap} in "${prop}".  [${sel}]`,
                );
              }
            }
          }
          if (prop === "border-radius") {
            const v = val.trim().toLowerCase();
            const usesToken = /var\(\s*--radius/.test(v);
            const pillOrCircle = /\b(9999px|999px|50%|100%)\b/.test(v);
            if (!usesToken && !pillOrCircle && /\d/.test(v)) {
              warn(
                "radius-from-token",
                `Hardcoded border-radius "${val}" — derive from var(--radius…). Pills/circles exempt.  [${sel}]`,
              );
            }
          }
        });
      });

      for (const name of declaredRootVars) {
        if (!isCanonicalToken(name)) {
          warn(
            "non-canonical-token",
            `:root defines ${name}, not in the contract vocabulary — migrate it (e.g. --ink→--fg, --hair/--rule→--border, --bg-2/--paper→--surface).`,
          );
        }
      }
    }
  }

  // 2. inline style="" — hardcoded colors
  const inlineRe = /style\s*=\s*"([^"]*)"/gi;
  let im: RegExpExecArray | null;
  while ((im = inlineRe.exec(html)) !== null) {
    const decl = im[1] ?? "";
    const hexes = decl.match(HEX_G);
    if (hexes && /(?:^|;)\s*(?:color|background|border|fill|stroke|outline)/i.test(decl)) {
      err(
        "color-from-token",
        `Hardcoded color ${hexes[0] ?? ""} in an inline style="" — resolve from a token.`,
      );
    }
  }

  // 3. token declaration / consumption
  if (kind === "document") {
    const missing = REQUIRED_TOKENS.filter((t) => !declaredRootVars.has(t));
    if (missing.length) {
      err(
        "declare-tokens",
        `:root is missing required contract tokens: ${missing.join(", ")}.`,
      );
    }
  } else if (kind === "fragment" && declaredRootVars.size > 0) {
    warn(
      "fragment-no-root",
      `A scoped fragment declares :root tokens (${[...declaredRootVars].slice(0, 5).join(", ")}…) — fragments should CONSUME host tokens, not redefine them.`,
    );
  }
  // kind === "section": a standalone section SOURCE — it carries its own :root
  // for preview, so neither the required-token nor the fragment-no-root rule
  // applies; the hex / hairline / vocabulary checks above still run.

  const errors = violations.filter((v) => v.level === "error");
  return { ok: errors.length === 0, kind, violations };
}
