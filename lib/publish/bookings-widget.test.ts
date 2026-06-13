// @vitest-environment node

import { describe, expect, it } from "vitest";
import { bakeBookings } from "./bookings-widget";

const CFG = { sub: "mysite" };
const DOC = (body: string) => `<!doctype html><html lang="es"><head></head><body>${body}</body></html>`;

describe("bakeBookings", () => {
  it("appends the widget before </body> when there's no placeholder", () => {
    const out = bakeBookings(DOC("<h1>hi</h1>"), CFG);
    expect(out).toContain("data-ol-bookings-widget");
    expect(out).toContain("data-ol-bookings-host");
    expect(out.indexOf("data-ol-bookings-host")).toBeLessThan(out.indexOf("</body>"));
  });

  it("renders IN the placeholder when present, not appended", () => {
    const out = bakeBookings(
      DOC('<section data-ol-bookings-section><p>El calendario aparecerá aquí.</p></section><footer>pie</footer>'),
      CFG,
    );
    expect(out).not.toContain("aparecerá aquí");
    expect(out.indexOf("data-ol-bookings-host")).toBeLessThan(out.indexOf("<footer>"));
    expect(out).toContain("pie");
  });

  it("is idempotent (does not double-inject)", () => {
    const once = bakeBookings(DOC("<h1>x</h1>"), CFG);
    const twice = bakeBookings(once, CFG);
    expect(twice).toBe(once);
    expect((twice.match(/data-ol-bookings-widget/g) ?? []).length).toBe(1);
  });

  it("bakes the sub + same-host API paths into the script", () => {
    const out = bakeBookings(DOC("x"), CFG);
    expect(out).toContain('"sub":"mysite"');
    expect(out).toContain("/api/bk/");
    expect(out).toContain("/api/m/"); // login path for requireLogin sites
  });

  it("uses relative API paths (host-only cookie stays first-party)", () => {
    const out = bakeBookings(DOC("x"), CFG);
    // No absolute apex base — calls go to the published host.
    expect(out).toContain('fetch("/api/bk/"');
    expect(out).not.toContain("https://openlen.com/api/bk");
  });

  it("renders dynamic values via textContent (XSS-safe), never innerHTML", () => {
    const out = bakeBookings(DOC("x"), CFG);
    expect(out).toContain("n.textContent=s.name");
    expect(out).toContain("c.textContent=sl.label");
  });

  it("escapes </script> in the embedded config", () => {
    const out = bakeBookings(DOC("x"), { sub: "x</script><script>evil" });
    expect(out).not.toContain("</script><script>evil");
    expect(out).toContain("\\u003c/script");
  });

  it("embeds locale strings and picks by <html lang> at runtime", () => {
    const out = bakeBookings(DOC("x"), CFG);
    expect(out).toContain("document.documentElement.lang");
    expect(out).toContain('"es"'); // Spanish strings embedded
    expect(out).toContain("Reserva una hora");
    expect(out).toContain("Book a time");
  });
});
