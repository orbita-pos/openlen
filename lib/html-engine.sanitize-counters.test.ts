import { describe, expect, it } from "vitest";

import { normalizeBornCanonical, sanitizeForPublish } from "@/lib/html-engine";

const PLAIN = "<!doctype html><html><head><title>x</title></head><body><section>hola</section></body></html>";

// The real second-pass shape, not a hand-written approximation: a document that
// already went through ingestion carries the three theme carriers, and every
// later sanitize kills them as ordinary inline scripts before healing them back.
const CANONICAL = normalizeBornCanonical(PLAIN);

const CARRIERS = ["radius", "space", "type"] as const;

function carrierBody(html: string, name: string): string | null {
  return new RegExp(`<script\\b[^>]*\\bdata-ol-${name}\\b[^>]*>([\\s\\S]*?)</script>`, "i").exec(html)?.[1] ?? null;
}

describe("sanitizeForPublish's removed counters", () => {
  it("has a fixture that actually carries the three theme scripts", () => {
    // Guards the three tests below: if normalize ever stops writing carriers,
    // they would all pass vacuously against a document with nothing to heal.
    for (const name of CARRIERS) expect(carrierBody(CANONICAL, name)).toEqual(expect.any(String));
  });

  it("reports nothing removed when the only strip was healed back", () => {
    const result = sanitizeForPublish(CANONICAL);
    expect(result.html).not.toBeNull();
    expect(result.removed.scripts).toBe(0);
    for (const name of CARRIERS) expect(carrierBody(result.html ?? "", name)).toBe(carrierBody(CANONICAL, name));
  });

  it("counts a model-authored script even when carriers are healed alongside it", () => {
    const withScript = CANONICAL.replace("</body>", "<script>console.log(1)</script></body>");
    const result = sanitizeForPublish(withScript);
    expect(result.removed.scripts).toBe(1);
    expect(result.html).not.toContain("console.log(1)");
  });

  it("keeps counting a forged carrier, whose content really was destroyed", () => {
    const forgedBody = "alert(1)";
    const original = carrierBody(CANONICAL, "radius");
    const forged = CANONICAL.replace(`<script data-ol-radius>${original}</script>`, `<script data-ol-radius>${forgedBody}</script>`);
    expect(carrierBody(forged, "radius")).toBe(forgedBody);

    const result = sanitizeForPublish(forged);
    // The other two carriers came back unchanged and are discounted; this one
    // lost its body to canonical bytes, so hiding it would hide exactly the
    // case the sanitizer exists for.
    expect(result.removed.scripts).toBe(1);
    expect(result.html).not.toContain(forgedBody);
    expect(carrierBody(result.html ?? "", "radius")).toBe(original);
  });

  // The accounting has to be per carrier element, not per carrier name: a
  // document can carry a decoy whose attribute merely starts like a carrier's,
  // or a second real carrier, either of them before the canonical one.
  it.each([
    ["an attribute that only starts like a carrier's", '<script data-ol-radius-unrelated>ruido()</script>'],
    ["a second carrier with a body of its own", '<script data-ol-radius="">ruido()</script>'],
  ])("counts the decoy and still discounts the healed carrier, given %s", (_name, decoy) => {
    // Before the real carrier in document order — the position that used to
    // capture the comparison and inflate the count.
    const withDecoy = CANONICAL.replace("<script data-ol-radius>", `${decoy}<script data-ol-radius>`);
    const result = sanitizeForPublish(withDecoy);
    expect(result.html).not.toContain("ruido()");
    expect(result.removed.scripts).toBe(1);
    expect(carrierBody(result.html ?? "", "radius")).toBe(carrierBody(CANONICAL, "radius"));
  });

  it("reports nothing removed for a document whose carriers were only injected", () => {
    // <style> siblings present, <script> siblings absent: the repair injects
    // three scripts that no strip ever removed.
    const stylesOnly = CANONICAL.replace(/<script\b[^>]*\bdata-ol-(?:radius|space|type)\b[^>]*>[\s\S]*?<\/script>/gi, "");
    for (const name of CARRIERS) expect(carrierBody(stylesOnly, name)).toBeNull();

    const result = sanitizeForPublish(stylesOnly);
    expect(result.removed.scripts).toBe(0);
  });

  it("leaves every other counter alone", () => {
    const hostile = CANONICAL.replace(
      "</body>",
      '<a href="javascript:alert(1)">x</a><div onclick="alert(2)"></div><iframe src="https://evil.test"></iframe></body>',
    );
    const result = sanitizeForPublish(hostile);
    expect(result.removed.eventHandlers).toBe(1);
    expect(result.removed.dangerousUrls).toBe(1);
    expect(result.removed.iframes).toBe(1);
    expect(result.removed.metaRefresh).toBe(0);
    expect(result.removed.scripts).toBe(0);
  });
});
