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

## An app: npm test

In an app, `npm test` runs `*.test.tsx` files with vitest and Testing Library in the same browser: render a component, act with `userEvent`, and assert on what is on screen (`screen.getByRole`, `findByText`). Put the tests next to the component or in `/tests`.
