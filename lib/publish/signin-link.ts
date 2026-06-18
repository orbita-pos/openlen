// Members module — sign-in link on PUBLIC published docs.
//
// When the Members module is on and the site has a gated portal page, every
// public document needs a way IN. Two cases, one pass:
//   • The page already has its own "Sign in" / "Iniciar sesión" link (curated
//     templates put one next to the nav CTA) → rewire its href to the portal,
//     keeping the template's exact styling. ALL matching links are rewired
//     (mobile menus often duplicate it).
//   • The page has none (AI-generated pages, after design-guidance stopped
//     authoring them) → inject a neutral, inherit-styled link as the last item
//     of the first <nav> (fallback: <header>, then a fixed top-right pill).
//
// Runs at publish time, AFTER the per-document bake and BEFORE the CSP seal, so
// the link is part of the page's policy. Adds no inline <script> (just an <a>),
// so no CSP hash is needed. Gated docs never get this — they carry logout
// wiring and their public path is a login stub. A no-op (returns the input)
// when there is no portal to link to.

const LABELS: Record<string, string> = {
  en: "Sign in",
  es: "Iniciar sesión",
  pt: "Entrar",
  fr: "Se connecter",
  de: "Anmelden",
  it: "Accedi",
  ja: "ログイン",
  ko: "로그인",
  zh: "登录",
  nl: "Inloggen",
};

// Visible-text phrases (lowercased) that identify a page's own sign-in link, so
// we rewire it instead of adding a second. Conservative + unambiguous on
// purpose — a false match would hijack a real nav link. Single ambiguous words
// ("entrar", "acceder") are deliberately excluded.
const SIGNIN_TEXTS = new Set([
  "sign in", "signin", "sign-in", "log in", "login", "log-in",
  "iniciar sesión", "iniciar sesion",
  "iniciar sessão", "iniciar sessao",
  "se connecter", "connexion",
  "anmelden", "einloggen",
  "accedi",
  "ログイン", "로그인", "登录", "登入",
  "inloggen", "aanmelden",
]);

/** The nav sign-in label for a locale (en fallback). */
export function signinLabelFor(locale?: string | null): string {
  return (locale && LABELS[locale]) || LABELS.en;
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Replace (or add) the href on an anchor's attribute string. */
function setHref(attrs: string, href: string): string {
  if (/\bhref\s*=/i.test(attrs)) {
    return attrs.replace(
      /(\bhref\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/i,
      `$1"${href}"`,
    );
  }
  return ` href="${href}"${attrs}`;
}

/** Visible text of an anchor's inner HTML — tags stripped, whitespace collapsed. */
function visibleText(innerHtml: string): string {
  return innerHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface SigninLinkOpts {
  /** Absolute path to the gated portal page, e.g. "/miembros". */
  href: string;
  /** Visible label for an INJECTED link (ignored when rewiring). */
  label: string;
}

/** Ensure a working sign-in entry on a public document. See file header. */
export function applySigninLink(html: string, opts: SigninLinkOpts): string {
  if (!html) return html;
  const href = escAttr(opts.href);

  // 1) Rewire every existing sign-in anchor to the portal.
  let rewired = false;
  const out = html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (full: string, attrs: string, inner: string) => {
      if (!SIGNIN_TEXTS.has(visibleText(inner))) return full;
      rewired = true;
      return `<a${setHref(attrs, href)}>${inner}</a>`;
    },
  );
  if (rewired) return out;

  // 2) Inject as the last item of the first <nav> (fallback <header>).
  const link = `<a href="${href}" data-ol-signin style="color:inherit;text-decoration:none;opacity:.85">${escText(opts.label)}</a>`;
  for (const tag of ["nav", "header"] as const) {
    const m = new RegExp(`</${tag}\\s*>`, "i").exec(html);
    if (m) return html.slice(0, m.index) + link + html.slice(m.index);
  }

  // 3) Last resort: a fixed pill so the entry is never lost.
  const pill = `<a href="${href}" data-ol-signin style="position:fixed;top:14px;right:14px;z-index:2147483600;font:500 13px/1 system-ui,-apple-system,sans-serif;padding:9px 15px;border-radius:999px;background:rgba(127,127,127,.16);color:inherit;text-decoration:none;backdrop-filter:blur(6px)">${escText(opts.label)}</a>`;
  const b = html.search(/<\/body\s*>/i);
  return b === -1 ? html + pill : html.slice(0, b) + pill + html.slice(b);
}
