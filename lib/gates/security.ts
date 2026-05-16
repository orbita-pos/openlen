import { load } from "cheerio";
import type { GateContext, GateResult, GateViolation } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate 5 — security.
//
// Deterministic regex + cheerio. Blocks must produce safe HTML — none of the
// vendored block components should ever emit these patterns, so triggering
// any of these is either a regression in a block or a slot value that leaked
// untrusted content into the markup.
//
// We allowlist a small set of well-known CDN hostnames for `<script src=...>`
// (Tailwind Play CDN, Google Fonts) and reject everything else. Inline scripts
// are blocked except the Tailwind config block, which the wrap-document helper
// in assemble.tsx emits inline by design.
// ─────────────────────────────────────────────────────────────────────────────

interface DangerousPattern {
  regex: RegExp;
  code: string;
  severity: "critical" | "warning";
}

const DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    regex:
      /\son(click|mouseover|mouseenter|mouseleave|load|error|focus|blur|change|submit|input|keydown|keyup|keypress)\s*=/gi,
    code: "inline-event-handler",
    severity: "critical",
  },
  { regex: /javascript:/gi, code: "javascript-url", severity: "critical" },
  { regex: /\bdata:text\/html/gi, code: "data-html-url", severity: "critical" },
  { regex: /\beval\s*\(/g, code: "eval-call", severity: "critical" },
  {
    regex: /\bnew\s+Function\s*\(/g,
    code: "function-constructor",
    severity: "critical",
  },
  {
    regex: /document\.write\s*\(/g,
    code: "document-write",
    severity: "critical",
  },
];

const ALLOWED_SCRIPT_HOSTS = [
  "cdn.tailwindcss.com",
  "unpkg.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdnjs.cloudflare.com",
] as const;

const ALLOWED_IFRAME_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "www.vimeo.com",
] as const;

export async function runSecurityGate(ctx: GateContext): Promise<GateResult> {
  const start = Date.now();
  const violations: GateViolation[] = [];
  const $ = load(ctx.html);

  // ── 1. Regex sweep for dangerous patterns ──────────────────────────────
  // We match against the raw HTML so escaped attributes (`onclick="..."`)
  // surface even when the attribute value would parse safely.
  for (const pat of DANGEROUS_PATTERNS) {
    const matches = Array.from(ctx.html.matchAll(pat.regex));
    for (const m of matches.slice(0, 5)) {
      // Tailwind's inline script contains a hash-router-style config that
      // legitimately uses arrow functions but no eval/Function constructor;
      // the patterns above already exclude it.
      violations.push({
        gate: "security",
        severity: pat.severity,
        code: pat.code,
        message: `Dangerous pattern detected: ${pat.code}`,
        evidence: { match: m[0], index: m.index },
      });
    }
  }

  // ── 2. <script src=""> allowlist ───────────────────────────────────────
  $("script[src]").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    const url = src.startsWith("//") ? `https:${src}` : src;
    try {
      const u = new URL(url, "https://example.com");
      const hostMatch = ALLOWED_SCRIPT_HOSTS.some((h) =>
        u.hostname === h || u.hostname.endsWith(`.${h}`),
      );
      if (!hostMatch) {
        violations.push({
          gate: "security",
          severity: "critical",
          code: "untrusted-script-src",
          message: `Script from non-allowlisted source: ${u.hostname}`,
          suggestion:
            "Either remove the script or extend ALLOWED_SCRIPT_HOSTS in lib/gates/security.ts.",
          evidence: { src },
        });
      }
    } catch {
      violations.push({
        gate: "security",
        severity: "critical",
        code: "invalid-script-src",
        message: `Malformed script src: ${src}`,
      });
    }
  });

  // ── 3. Inline <script> body — only the Tailwind config block is allowed.
  $("script:not([src])").each((_, el) => {
    const content = ($(el).html() ?? "").trim();
    if (content.length === 0) return;
    // JSON-LD is a different `type=` — cheerio includes it in script not(src)
    // when no type filter is applied. Allow application/ld+json explicitly.
    const type = $(el).attr("type") ?? "";
    if (type === "application/ld+json") return;
    // Tailwind config: a literal `tailwind.config = { ... }` assignment that
    // the assemble step may emit. Currently we don't emit one but reserve it.
    if (/^\s*tailwind\.config\s*=/.test(content)) return;
    violations.push({
      gate: "security",
      severity: "critical",
      code: "inline-script",
      message: "Inline <script> with arbitrary JS detected.",
      evidence: { content: content.slice(0, 200) },
    });
  });

  // ── 4. <iframe> hosts (untrusted embeds are a phishing vector) ─────────
  $("iframe").each((_, el) => {
    const src = $(el).attr("src") ?? "";
    if (!src) return;
    try {
      const u = new URL(src);
      if (u.protocol !== "https:") {
        violations.push({
          gate: "security",
          severity: "critical",
          code: "non-https-iframe",
          message: `iframe must be https (got ${u.protocol}).`,
        });
        return;
      }
      const hostMatch = ALLOWED_IFRAME_HOSTS.some(
        (h) => u.hostname === h || u.hostname.endsWith(`.${h}`),
      );
      if (!hostMatch) {
        violations.push({
          gate: "security",
          severity: "critical",
          code: "untrusted-iframe",
          message: `iframe from non-allowlisted host: ${u.hostname}`,
          evidence: { src },
        });
      }
    } catch {
      violations.push({
        gate: "security",
        severity: "critical",
        code: "invalid-iframe-src",
        message: `Malformed iframe src: ${src}`,
      });
    }
  });

  // ── 5. target="_blank" without rel="noopener" — tab-nabbing vector. ─────
  $('a[target="_blank"]').each((_, el) => {
    const rel = ($(el).attr("rel") ?? "").toLowerCase();
    if (!rel.includes("noopener") && !rel.includes("noreferrer")) {
      violations.push({
        gate: "security",
        severity: "warning",
        code: "target-blank-no-noopener",
        message: 'target="_blank" link missing rel="noopener" (tab-nabbing risk).',
        evidence: { href: $(el).attr("href") },
      });
    }
  });

  return {
    gate: "security",
    passed: violations.filter((v) => v.severity === "critical").length === 0,
    violations,
    durationMs: Date.now() - start,
    cost: 0,
  };
}
