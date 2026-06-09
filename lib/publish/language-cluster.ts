// SEO + navigation annotations for a published page and its translated
// locale variants (Speak Every Language). Pure string transforms in the
// same style as the analytics snippet inject — they run inside publishToDir
// AFTER the bakes and BEFORE the seal (the switcher is pure <a> markup, no
// scripts, so the CSP stays hash-locked).
//
// For a single-language page only the canonical is added (closing a
// long-standing published-SEO gap). With locale variants, every document
// in the cluster gets the full hreflang set (Google's rule: hreflang links
// must be reciprocal on every page), x-default pointing at the root, and a
// fixed bottom-right language switcher.

export interface ClusterMember {
  /** BCP-47 primary code — "es", "fr". */
  lang: string;
  /** Site-absolute path — "/" for the root document, "/es/" for variants. */
  path: string;
}

export interface AnnotateOptions {
  /** Origin of the published site, no trailing slash. */
  baseUrl: string;
  /** This document's own path within the cluster. */
  selfPath: string;
  /** Root first. A single member = canonical only. */
  cluster: ClusterMember[];
}

/** `<html lang>` primary subtag of the document, lowercased. */
export function detectHtmlLang(html: string): string | null {
  const m = /<html\b[^>]*\blang=["']?([a-zA-Z-]+)/i.exec(html);
  return m ? m[1].split("-")[0].toLowerCase() : null;
}

function headInject(html: string, block: string): string {
  const idx = html.lastIndexOf("</head>");
  if (idx === -1) return html;
  return html.slice(0, idx) + block + html.slice(idx);
}

function bodyInject(html: string, block: string): string {
  const idx = html.lastIndexOf("</body>");
  if (idx === -1) return html + block;
  return html.slice(0, idx) + block + html.slice(idx);
}

export function annotateLanguageCluster(
  html: string,
  opts: AnnotateOptions,
): string {
  const { baseUrl, selfPath, cluster } = opts;
  let out = html;

  const headParts: string[] = [];
  if (!/rel=["']canonical["']/i.test(out)) {
    headParts.push(`<link rel="canonical" href="${baseUrl}${selfPath}">`);
  }
  if (cluster.length > 1 && !out.includes("data-ol-hreflang")) {
    for (const m of cluster) {
      headParts.push(
        `<link rel="alternate" hreflang="${m.lang}" href="${baseUrl}${m.path}" data-ol-hreflang>`,
      );
    }
    headParts.push(
      `<link rel="alternate" hreflang="x-default" href="${baseUrl}${cluster[0].path}" data-ol-hreflang>`,
    );
  }
  if (headParts.length > 0) {
    out = headInject(out, `\n${headParts.join("\n")}\n`);
  }

  if (cluster.length > 1 && !out.includes("data-ol-lang-switcher")) {
    const links = cluster
      .map((m) => {
        const current = m.path === selfPath;
        const style = current
          ? "padding:6px 9px;border-radius:999px;text-decoration:none;background:#111827;color:#fff"
          : "padding:6px 9px;border-radius:999px;text-decoration:none;color:#374151";
        return `<a href="${m.path}"${current ? ' aria-current="page"' : ""} style="${style}">${m.lang.toUpperCase()}</a>`;
      })
      .join("");
    const nav = `<nav data-ol-lang-switcher aria-label="Languages" style="position:fixed;bottom:16px;right:16px;z-index:2147483000;display:flex;gap:2px;padding:4px;background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border-radius:999px;box-shadow:0 2px 14px rgba(0,0,0,.18);font:600 11px/1 system-ui,-apple-system,sans-serif">${links}</nav>`;
    out = bodyInject(out, nav);
  }

  return out;
}

/** sitemap.xml for the release — one <url> per cluster member, with
 *  reciprocal xhtml:link alternates when the page is multilingual. */
export function buildSitemap(baseUrl: string, cluster: ClusterMember[]): string {
  const multi = cluster.length > 1;
  const alternates = multi
    ? cluster
        .map(
          (m) =>
            `    <xhtml:link rel="alternate" hreflang="${m.lang}" href="${baseUrl}${m.path}"/>`,
        )
        .join("\n")
    : "";
  const urls = cluster
    .map((m) => {
      const body = [`    <loc>${baseUrl}${m.path}</loc>`];
      if (multi) body.push(alternates);
      return `  <url>\n${body.join("\n")}\n  </url>`;
    })
    .join("\n");
  const xmlnsXhtml = multi ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xmlnsXhtml}>\n${urls}\n</urlset>\n`;
}

export function buildRobots(baseUrl: string): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`;
}
