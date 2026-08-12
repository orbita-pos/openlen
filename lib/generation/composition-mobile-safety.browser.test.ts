import { describe, expect, it } from "vitest";

import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { ensureCompositionMobileSafety } from "./composition-mobile-safety";

const FLEX_HEADING = `<!doctype html><html><head><style>
  *{box-sizing:border-box}html,body{margin:0;width:100%}
  [data-openlen-role]{padding:20px;width:100%;font-family:Arial,sans-serif}
  .topbar{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}
  h2{font-size:52px;line-height:1;margin:0}.count{flex:0 0 auto}
</style></head><body><main><section data-openlen-role="coloring_gallery">
  <div class="topbar"><div><h2>Creaciones de nuestros&nbsp;pequeños&nbsp;artistas.</h2></div><div class="count">1,240 obras</div></div>
</section></main></body></html>`;

describe("composition mobile safety browser contract", () => {
  it("removes the verified flex heading overflow without hiding content", async () => {
    const before = await renderVisualQualityViewports(FLEX_HEADING);
    const after = await renderVisualQualityViewports(ensureCompositionMobileSafety(FLEX_HEADING));

    expect(before).toMatchObject({ mobileOverflow: true });
    expect(after).toMatchObject({
      mobileOverflow: false,
      weakTypographyHierarchy: false,
      squareComponentTreatment: false,
    });
  }, 30_000);
});
