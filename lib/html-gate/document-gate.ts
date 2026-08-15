const RESERVED_MARKER = "data-slot-path=";

export type HtmlGateRefusal =
  | "reserved_marker"
  | "sanitization_failed"
  | "behaviors_invalid"
  | "seal_failed"
  | "render_failed";

export interface HtmlGateDeps {
  readonly sanitize: (html: string) => { html: string | null; errors: string[]; removed: { scripts: number; eventHandlers: number; dangerousUrls: number; iframes: number; metaRefresh: number } };
  readonly seal: (html: string) => { html: string; sealed: boolean };
  readonly render?: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
}

export interface HtmlGatePolicy {
  readonly render: boolean;
}

export type HtmlGateResult =
  | { readonly ok: true; readonly html: string; readonly removed: { scripts: number; eventHandlers: number; iframes: number; dangerousUrls: number } }
  | { readonly ok: false; readonly code: HtmlGateRefusal; readonly detail?: string };

/**
 * The only place a document becomes safe to keep. Every surface that changes
 * page HTML passes through here, so a guarantee added once protects all of
 * them. Order is part of the contract: the reserved marker is refused before
 * any pass that could rewrite it out of sight.
 */
export async function passHtmlGate(
  html: string,
  deps: HtmlGateDeps,
  policy: HtmlGatePolicy,
): Promise<HtmlGateResult> {
  if (html.includes(RESERVED_MARKER)) return { ok: false, code: "reserved_marker" };

  const sanitized = deps.sanitize(html);
  if (sanitized.html === null) return { ok: false, code: "sanitization_failed" };

  const sealed = deps.seal(sanitized.html);
  if (!sealed.sealed) return { ok: false, code: "seal_failed" };

  if (policy.render) {
    if (!deps.render) return { ok: false, code: "render_failed", detail: "renderer_unavailable" };
    const rendered = await deps.render(sealed.html);
    if (!rendered) return { ok: false, code: "render_failed", detail: "render_unavailable" };
    if (rendered.mobileOverflow) return { ok: false, code: "render_failed", detail: "mobile_overflow" };
    if (rendered.invalidGeometry) return { ok: false, code: "render_failed", detail: "invalid_geometry" };
  }

  return {
    ok: true,
    html: sealed.html,
    removed: {
      scripts: sanitized.removed.scripts,
      eventHandlers: sanitized.removed.eventHandlers,
      iframes: sanitized.removed.iframes,
      dangerousUrls: sanitized.removed.dangerousUrls,
    },
  };
}
