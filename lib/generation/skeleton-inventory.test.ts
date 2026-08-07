import { describe, expect, it } from "vitest";
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

  it("fails closed with a typed error when no safe template skeleton can be extracted", () => {
    expect(() => buildSkeletonInventory("<main><section", "color-base")).toThrow(SkeletonInventoryError);
    expect(() => buildSkeletonInventory("<main><section", "color-base")).toThrow(expect.objectContaining({ code: "insufficient_style_hooks" }));
  });
});
