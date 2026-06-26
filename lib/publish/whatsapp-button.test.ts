import { describe, expect, it } from "vitest";
import { bakeWhatsAppButton, waHref } from "./whatsapp-button";

const DOC = (body = "<h1>Hi</h1>") =>
  `<!doctype html><html><head><title>T</title></head><body>${body}</body></html>`;

describe("waHref", () => {
  it("treats a 10-digit number as Mexico (+52)", () => {
    expect(waHref("5512345678")).toBe("https://wa.me/525512345678");
  });
  it("keeps an already-international number as-is (not the 10-digit MX case)", () => {
    expect(waHref("+52 1 55 1234 5678")).toBe("https://wa.me/5215512345678");
  });
  it("strips non-digits", () => {
    expect(waHref("(551) 234-5678")).toBe("https://wa.me/525512345678");
  });
  it("appends a url-encoded prefilled message", () => {
    expect(waHref("5512345678", "Hola, vi tu página")).toBe(
      "https://wa.me/525512345678?text=Hola%2C%20vi%20tu%20p%C3%A1gina",
    );
  });
  it("returns null for an unusable (too short) number", () => {
    expect(waHref("123")).toBeNull();
    expect(waHref("")).toBeNull();
  });
});

describe("bakeWhatsAppButton", () => {
  it("injects a FAB before </body>", () => {
    const out = bakeWhatsAppButton(DOC(), { number: "5512345678" });
    expect(out).toContain("data-ol-wa-button");
    expect(out).toContain("https://wa.me/525512345678");
    expect(out.indexOf("data-ol-wa-button")).toBeLessThan(out.indexOf("</body>"));
  });

  it("no-ops without a usable number", () => {
    const doc = DOC();
    expect(bakeWhatsAppButton(doc, { number: "" })).toBe(doc);
    expect(bakeWhatsAppButton(doc, { number: "12" })).toBe(doc);
  });

  it("is idempotent (marker guard)", () => {
    const once = bakeWhatsAppButton(DOC(), { number: "5512345678" });
    expect(bakeWhatsAppButton(once, { number: "5512345678" })).toBe(once);
  });

  it("DEDUP: suppressed when the profile contact widget is already present", () => {
    const withWidget = DOC('<h1>Hi</h1><div data-ol-contact-widget>…</div>');
    expect(bakeWhatsAppButton(withWidget, { number: "5512345678" })).toBe(withWidget);
  });

  it("defaults the bottom offset to 18px", () => {
    expect(bakeWhatsAppButton(DOC(), { number: "5512345678" })).toContain("bottom:18px");
  });

  it("raises the FAB above a same-corner widget when bottomPx is set", () => {
    const out = bakeWhatsAppButton(DOC(), { number: "5512345678", bottomPx: 86 });
    expect(out).toContain("bottom:86px");
    expect(out).not.toContain("bottom:18px");
  });

  it("honors the left side", () => {
    const out = bakeWhatsAppButton(DOC(), { number: "5512345678", side: "left" });
    expect(out).toContain("left:18px");
    expect(out).not.toContain("right:18px");
  });

  it("url-encodes the message so it can't break the href attribute", () => {
    const out = bakeWhatsAppButton(DOC(), { number: "5512345678", message: 'a"b' });
    expect(out).not.toContain('text=a"b'); // no raw quote breaks out of the attr
    expect(out).toContain("text=a%22b"); // encoded instead
  });
});
