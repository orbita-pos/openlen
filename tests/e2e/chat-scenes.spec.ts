// LAYER 1 OF LEN 3.1 (spec local 2026-10-24-len-3-1-layers-0-1, §5.3): the real
// production scenes on the dev chat page, one full-page screenshot each, for a
// PERSON to look at (the automatic checks are `chat-scenes.test.tsx`). Not part
// of the deploy gate. Needs the dev server up (`npm run dev`) and the scenes
// downloaded (`npm run replay-scenes:fetch`); OPENLEN_DEV_URL overrides
// http://localhost:3000. Run: `npm run test:e2e -- chat-scenes`.
import { test, expect } from "@playwright/test";

import { readScene, scenes } from "../../lib/agent/replay-scenes/scene-files";

const BASE = process.env.OPENLEN_DEV_URL ?? "http://localhost:3000";

for (const scene of scenes) {
  test(`scene ${scene.name} on /dev/chat`, async ({ page }) => {
    test.skip(!readScene(scene.name), `scene ${scene.name} not downloaded`);
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto(`${BASE}/es/dev/chat?solo=new&scene=${encodeURIComponent(scene.name)}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `test-results/chat-scenes/${scene.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
