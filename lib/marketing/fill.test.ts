import { describe, expect, it } from "vitest";
import { fillPostTemplate } from "./fill";

const doc = `<!doctype html><html><head><style>:root { --accent:#FF5A36; --bg:#141414; }</style></head>
<body><div data-ol-photo><img src="" alt=""/></div>
<div data-ol-slot="businessName">X</div>
<span data-ol-slot="phone" data-ol-slot-hide-empty style="color:red">Y</span>
<span data-ol-slot="offer">Z</span></body></html>`;

describe("fillPostTemplate", () => {
  it("fills slots with escaped values", () => {
    const out = fillPostTemplate(doc, { businessName: "Tacos <El> \"Güero\"", offer: "2x1 martes" });
    expect(out).toContain("Tacos &lt;El&gt; &quot;Güero&quot;");
    expect(out).toContain("2x1 martes");
    expect(out).not.toContain(">X<");
  });
  it("hides hide-empty slots when data is missing", () => {
    const out = fillPostTemplate(doc, { businessName: "A" });
    expect(out).toMatch(/data-ol-slot="phone"[^>]*style="color:red;display:none"/);
  });
  it("overrides :root tokens with valid hex only", () => {
    const out = fillPostTemplate(doc, { accent: "#00AA88", bg: "javascript:alert(1)" });
    expect(out).toContain("--accent:#00AA88");
    expect(out).toContain("--bg:#141414"); // invalid value dropped
  });
  it("sets the photo or hides the photo box", () => {
    const withPhoto = fillPostTemplate(doc, { photoUrl: "https://images.openlen.com/a.webp" });
    expect(withPhoto).toContain('src="https://images.openlen.com/a.webp"');
    const noPhoto = fillPostTemplate(doc, {});
    expect(noPhoto).toMatch(/data-ol-photo[^>]*style="[^"]*display:none/);
  });
  it("does not expand $-replacement patterns from data values", () => {
    const out = fillPostTemplate(doc, { photoUrl: "https://evil.example/$&x" });
    expect(out).toContain('src="https://evil.example/$&amp;x"');
    const out2 = fillPostTemplate(doc, { businessName: "Tacos $' $1 $$" });
    expect(out2).toContain("Tacos $&#39; $1 $$");
  });
  it("rejects invalid hex lengths (5/7 digits)", () => {
    const out = fillPostTemplate(doc, { accent: "#12345" });
    expect(out).toContain("--accent:#FF5A36");
  });
});
