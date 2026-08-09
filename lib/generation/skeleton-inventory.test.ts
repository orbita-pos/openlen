import { describe, expect, it } from "vitest";
import { parse } from "node-html-parser";
import { buildSkeletonInventory, SkeletonInventoryError } from "@/lib/generation/skeleton-inventory";

const HTML = `<!doctype html>
<html style="--ol-bg: #fff"><body>
  <header><nav><img class="logo" src="/logo.svg" alt="Openlen logo"><a class="nav-link" href="/about">About</a></nav></header>
  <main>
    <section class="hero"><img src="/classroom.jpg" alt="Classroom"><button class="primary-button">Start</button></section>
    <section><article class="activity-card"><img src="/workbook.jpg" alt="Workbook"><a class="card-link" href="/workbook">Open</a></article><article class="activity-card">Second card</article></section>
    <section><div class="activity-card">Third card</div><form action="/subscribe"><input name="email"><button>Subscribe</button></form></section>
    <section><svg data-lucide="sparkles" aria-hidden="true"></svg><img src="data:image/svg+xml;base64,abc" alt="Inline"><img src="/bound.jpg" alt="Bound" data-ol-click="open"></section>
  </main>
  <footer><img src="/footer-mark.svg" alt="Footer mark"></footer>
  <script>window.keepThis = true;</script>
</body></html>`;

describe("buildSkeletonInventory", () => {
  it("builds a deterministic inventory from safe template structure", () => {
    const inventory = buildSkeletonInventory(HTML, "color-base");

    expect(inventory.schemaVersion).toBe("skeleton-inventory/1.0");
    expect(inventory.templateId).toBe("color-base");
    expect(inventory.styleHooks.map((hook) => hook.id)).toEqual([
      "page", "navigation", "hero", "section-1", "section-2",
      "section-3", "cards-activity-card", "buttons", "icons",
    ]);
    expect(inventory.assetSlots).toEqual([
      { slotIndex: 0, kind: "image", role: "hero", currentAlt: "Classroom", replaceable: true },
      { slotIndex: 1, kind: "image", role: "card", currentAlt: "Workbook", replaceable: true },
    ]);
  });

  it("excludes logo, navigation, footer, data URI, and behavior-bound images from replacement", () => {
    const inventory = buildSkeletonInventory(HTML, "color-base");

    expect(inventory.assetSlots.map((asset) => asset.currentAlt)).toEqual(["Classroom", "Workbook"]);
  });

  it("excludes logos identified on the image and data URIs in srcset", () => {
    const adversarialHtml = HTML.replace("</main>", `<section>
      <img id="brand-logo" src="/brand-logo.png" alt="Brand mark">
      <img src="/image.jpg" srcset="data:image/png;base64,abc 1x" alt="Data srcset">
      <img src="/safe.jpg" alt="Safe content">
    </section></main>`);
    const inventory = buildSkeletonInventory(adversarialHtml, "color-base");

    expect(inventory.assetSlots.map((asset) => asset.currentAlt)).toEqual(["Classroom", "Workbook", "Safe content"]);
  });

  it("uses DOM-path selectors that uniquely scope hooks amid colliding markup", () => {
    const collisionHtml = `<!doctype html><html><body>
      <nav id="primary-nav"></nav>
      <main id="application">
        <nav id="nested-nav"></nav>
        <section id="hero-section"><section id="nested-section"></section></section>
        <section id="card-section"><article id="card-a" class="activity-card"></article><article id="card-b" class="activity-card"></article></section>
      </main>
      <section id="outside-section"><article id="outside-card" class="activity-card"></article></section>
    </body></html>`;
    const inventory = buildSkeletonInventory(collisionHtml, "collision-base");
    const dom = parse(collisionHtml);
    const idsFor = (hookId: string) => dom.querySelectorAll(inventory.styleHooks.find((hook) => hook.id === hookId)!.selector).map((element) => element.getAttribute("id"));

    expect(idsFor("navigation")).toEqual(["primary-nav"]);
    expect(idsFor("hero")).toEqual(["hero-section"]);
    expect(idsFor("section-1")).toEqual(["nested-section"]);
    expect(idsFor("cards-activity-card")).toEqual(["card-a", "card-b"]);
  });

  it("keeps the buttons hook within the selector contract for many safe anchor classes", () => {
    const anchorClasses = Array.from({ length: 24 }, (_, index) => `action-control-${String(24 - index).padStart(2, "0")}`);
    const buttonHtml = `<!doctype html><html><body><main>
      <section class="hero"><button id="primary-button">Start</button></section>
      ${anchorClasses.map((className) => `<a id="${className}" class="${className}" href="/${className}">Open</a>`).join("")}
    </main></body></html>`;

    const inventory = buildSkeletonInventory(buttonHtml, "button-selector-limit");
    const repeatedInventory = buildSkeletonInventory(buttonHtml, "button-selector-limit");
    const selector = inventory.styleHooks.find((hook) => hook.id === "buttons")!.selector;
    const selectedIds = parse(buttonHtml).querySelectorAll(selector).map((element) => element.getAttribute("id"));
    const selectedAnchorClasses = [...anchorClasses]
      .sort()
      .filter((className) => selectedIds.includes(className));
    const anchorSelectorFragments = selector.split(", ").filter((fragment) => fragment.startsWith("a."));

    expect(selector).toBe(repeatedInventory.styleHooks.find((hook) => hook.id === "buttons")!.selector);
    expect(selector.length).toBeLessThanOrEqual(240);
    expect(selectedIds).toContain("primary-button");
    expect(selectedAnchorClasses).not.toHaveLength(0);
    expect(selectedAnchorClasses).toEqual([...anchorClasses].sort().slice(0, selectedAnchorClasses.length));
    expect(anchorSelectorFragments).toEqual(selectedAnchorClasses.map((className) => `a.${className}`));
  });

  it("maps runtime schema validation failures to a typed inventory error", () => {
    expect(() => buildSkeletonInventory(HTML, "x".repeat(181))).toThrow(SkeletonInventoryError);
    expect(() => buildSkeletonInventory(HTML, "x".repeat(181))).toThrow(expect.objectContaining({ code: "invalid_inventory" }));
  });

  it("fails closed with a typed error when no safe template skeleton can be extracted", () => {
    expect(() => buildSkeletonInventory("<main><section", "color-base")).toThrow(SkeletonInventoryError);
    expect(() => buildSkeletonInventory("<main><section", "color-base")).toThrow(expect.objectContaining({ code: "insufficient_style_hooks" }));
  });
});
