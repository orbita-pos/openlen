export interface PostData {
  businessName?: string; tagline?: string; offer?: string; price?: string;
  phone?: string; whatsapp?: string; address?: string; hours?: string;
  url?: string; logoInitial?: string; photoUrl?: string;
  accent?: string; bg?: string; ink?: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const TOKEN_KEYS = [["accent", "--accent"], ["bg", "--bg"], ["ink", "--ink"]] as const;

export function fillPostTemplate(html: string, data: PostData): string {
  let out = html;
  for (const [key, cssVar] of TOKEN_KEYS) {
    const v = data[key];
    if (v && HEX.test(v)) {
      out = out.replace(new RegExp(`${cssVar}\\s*:\\s*[^;}]+`), `${cssVar}:${v}`);
    }
  }
  out = out.replace(
    /(<([a-z0-9]+)([^>]*\bdata-ol-slot="([a-zA-Z]+)"[^>]*)>)([\s\S]*?)(<\/\2>)/g,
    (_m, open: string, _tag: string, attrs: string, key: string, _inner: string, close: string) => {
      const value = (data as Record<string, string | undefined>)[key];
      if (value) return `${open}${escapeHtml(value)}${close}`;
      const opened = attrs.includes("data-ol-slot-hide-empty")
        ? hideElement(open) : open;
      return `${opened}${close}`;
    },
  );
  out = out.replace(/(<[a-z0-9]+[^>]*\bdata-ol-photo\b[^>]*>)([\s\S]*?<img[^>]*>)/, (m, open: string, rest: string) => {
    if (data.photoUrl && /^https?:\/\//.test(data.photoUrl)) {
      return open + rest.replace(/src="[^"]*"/, `src="${escapeHtml(data.photoUrl)}"`);
    }
    return hideElement(open) + rest;
  });
  return out;
}

function hideElement(openTag: string): string {
  if (/style="/.test(openTag)) return openTag.replace(/style="([^"]*)"/, 'style="$1;display:none"');
  return openTag.replace(/>$/, ' style="display:none">');
}
