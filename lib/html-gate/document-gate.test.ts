import { describe, expect, it, vi } from "vitest";

import { passHtmlGate, type HtmlGateDeps } from "./document-gate";

const OK_HTML = "<!doctype html><html><head></head><body><section>hola</section></body></html>";

function deps(over: Partial<HtmlGateDeps> = {}): HtmlGateDeps {
  return {
    sanitize: (html) => ({ html, errors: [], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    seal: (html) => ({ html, sealed: true }),
    render: async () => ({ mobileOverflow: false, invalidGeometry: false }),
    ...over,
  };
}

describe("passHtmlGate", () => {
  it("returns sealed html when every guarantee holds", async () => {
    await expect(passHtmlGate(OK_HTML, deps(), { render: true }))
      .resolves.toMatchObject({ ok: true });
  });

  it("refuses the reserved editor marker before anything else runs", async () => {
    const sanitize = vi.fn();
    const result = await passHtmlGate(
      '<!doctype html><html><head></head><body><section data-slot-path="a">x</section></body></html>',
      deps({ sanitize: sanitize as never }),
      { render: true },
    );
    // The marker must never reach disk or the database, so it is refused
    // before any pass that could rewrite it out of sight.
    expect(result).toMatchObject({ ok: false, code: "reserved_marker" });
    expect(sanitize).not.toHaveBeenCalled();
  });

  it("refuses a document sanitization cannot save", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ sanitize: () => ({ html: null, errors: ["x"], removed: { scripts: 0, eventHandlers: 0, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }) }), { render: true }))
      .resolves.toMatchObject({ ok: false, code: "sanitization_failed" });
  });

  it("refuses a document the sealer will not seal", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ seal: (html) => ({ html, sealed: false }) }), { render: true }))
      .resolves.toMatchObject({ ok: false, code: "seal_failed" });
  });

  it("refuses a document that renders broken", async () => {
    await expect(passHtmlGate(OK_HTML, deps({ render: async () => ({ mobileOverflow: true, invalidGeometry: false }) }), { render: true }))
      .resolves.toMatchObject({ ok: false, code: "render_failed" });
  });

  it("skips the browser when the caller's policy says so", async () => {
    const render = vi.fn(async () => ({ mobileOverflow: true, invalidGeometry: true }));
    // An interactive edit cannot pay twenty seconds. The cheap invariants
    // still ran; only the expensive verification is deferred to publish.
    await expect(passHtmlGate(OK_HTML, deps({ render }), { render: false }))
      .resolves.toMatchObject({ ok: true });
    expect(render).not.toHaveBeenCalled();
  });

  it("reports what sanitization stripped so a caller can warn the user", async () => {
    const result = await passHtmlGate(OK_HTML, deps({
      sanitize: (html) => ({ html, errors: [], removed: { scripts: 2, eventHandlers: 1, dangerousUrls: 0, iframes: 0, metaRefresh: 0 } }),
    }), { render: false });
    expect(result).toMatchObject({ ok: true, removed: { scripts: 2, eventHandlers: 1 } });
  });
});
