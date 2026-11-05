# Tests that run again

Write one only when the user wants a check kept, to run again after each change.

## A page: Playwright in /tests

`npx playwright test` runs the files in `/tests` in the terminal's Chromium, against the saved draft. Playwright is already installed: import from `@playwright/test` and don't install it. The draft's address is in `$BASE_URL`, so `/playwright.config.ts` says:

```ts
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "tests", use: { baseURL: process.env.BASE_URL } });
```

Look first, then act: read the page's file, or open it once, to learn the texts, labels and roles the test will use. Wait until the page has finished loading before looking for anything that its script builds.

```ts
import { test, expect } from "@playwright/test";

test("the booking form confirms", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Name").fill("Ana");
  await page.getByLabel("Email").fill("ana@example.com");
  await page.getByRole("button", { name: "Book" }).click();
  await expect(page.getByText("See you on")).toBeVisible();
});
```

- Find elements the way a visitor does: `getByRole` with the accessible name, `getByLabel`, `getByText`. A CSS class or an id only when nothing visible names it.
- `expect(...)` waits by itself: don't add fixed pauses.
- A test works with the draft's data; it can read the published site but never writes to it.
- Screenshot comparisons (`toHaveScreenshot`) can't be kept: only text files are saved.
- The tests are kept with the project and never published.

## Looking at motion

Not a test to keep: a script you run once to see how the page moves, in the terminal's Chromium, against the saved draft (`$BASE_URL`). WebGL works there with Chromium as it is: no launch options. The frames go to `/tmp/motion/`, outside the project, so nothing of them is saved.

```js
// /tmp/motion/look.cjs — run it with: node /tmp/motion/look.cjs
const { chromium } = require("@playwright/test");
const { mkdirSync } = require("node:fs");

(async () => {
  mkdirSync("/tmp/motion", { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  // Time under your control. Installed, the page's clock still runs by itself while a screenshot is
  // taken; paused, it only moves with runFor, so the same script gives the same frames every time.
  await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
  // The same random numbers every run, so two runs can be compared.
  await page.addInitScript(() => { let s = 1; Math.random = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646; });
  await page.goto(process.env.BASE_URL);
  await page.clock.runFor(500); // let it load and draw
  await page.keyboard.down("ArrowRight"); // held, not pressed
  for (let i = 0; i < 8; i++) {
    await page.clock.runFor(100);
    await page.screenshot({ path: `/tmp/motion/${String(i).padStart(2, "0")}.png` });
  }
  await page.keyboard.up("ArrowRight");
  await browser.close();
})();
```

Then one image with all of them, and a look at it:

```
python3 <base directory>/scripts/contact_sheet.py --out /tmp/motion/sheet.png /tmp/motion
```

`--label` once per frame puts a line under each (`--label "t=100ms ArrowRight"`). `Read` `/tmp/motion/sheet.png` shows the sheet; `Read` one frame with `region` to look at a detail.

- Drag: `page.mouse.move(x, y)`, `page.mouse.down()`, `page.mouse.move(x2, y2, { steps: 12 })`, `page.mouse.up()`.
- With and without the input: run it again without `keyboard.down`; if the sheets are the same, the key does nothing.
- What has no picture (a score, a position) reads with `page.evaluate`, and `clock.runFor` moves the game between reads.
- Each run takes a few seconds. Keep the series short and look before running another.

## An app: npm test

In an app, `npm test` runs `*.test.tsx` files with vitest and Testing Library in the same browser: render a component, act with `userEvent`, and assert on what is on screen (`screen.getByRole`, `findByText`). Put the tests next to the component or in `/tests`.
