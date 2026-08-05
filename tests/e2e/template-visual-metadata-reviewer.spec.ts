import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewClientAssets } from "../../lib/templates/visual-metadata-review-launcher";
import { openVisualMetadataReviewWorkspace } from "../../lib/templates/visual-metadata-review-session-store";
import { startVisualMetadataReviewServer, type RunningReviewServer } from "../../lib/templates/visual-metadata-review-server";
import {
  VISUAL_METADATA_ARTIFACT_VERSION,
  VISUAL_METADATA_DECISION_VERSION,
  type SuggestionArtifactRow,
} from "../../lib/templates/visual-metadata-review-workflow";
import type { ReviewClientAssets } from "../../lib/templates/visual-metadata-review-server";

const TEST_REVIEWER = { name: "E2E Test Reviewer", email: "e2e-reviewer@example.test" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlHh34AAAAASUVORK5CYII=", "base64");
const PRIVATE_MARKERS = ["raw_evidence_should_never_render", "private@example.test", "source-path-should-not-render", "upstream-secret"];

let assets: ReviewClientAssets;

function metadata() {
  return {
    schemaVersion: "template-visual-metadata/1.0" as const,
    domains: ["saas"], audiences: ["founders"], ageRanges: [], emotionalRegisters: ["confident"],
    visualArchetypes: ["editorial"], visualSignals: ["high_contrast"], layoutTraits: ["split_layout"],
    requiredAssetTypes: [], negativeTags: [], supportedSiteTypes: ["landing_page"], supportedSectionRoles: ["hero"],
    themeability: "high" as const, identityStrength: "medium" as const, reviewStatus: "unreviewed" as const,
  };
}

function provenance() {
  return {
    workflowVersion: "template-visual-metadata-suggestion-workflow/1.0" as const,
    modelChoice: { version: "template-visual-metadata-model-choice/1.0" as const, modelId: "synthetic-e2e" },
    promptVersion: "template-visual-metadata-prompt/3.0" as const,
    schemaVersion: "template-visual-metadata/1.0" as const,
    generationConfig: {
      version: "template-visual-metadata-generation-config/3.0" as const,
      temperature: 0.2 as const, maxOutputTokens: 2048 as const, responseMimeType: "application/json" as const,
      responseJsonSchemaVersion: "template-visual-metadata/1.0" as const, thinkingBudget: 0 as const,
    },
    failurePolicy: { version: "template-visual-metadata-failure-policy/1.0" as const, maximumFailureRate: 0.1 },
    timeoutPolicy: { version: "template-visual-metadata-timeout-policy/1.0" as const, timeoutMs: 60_000 },
  };
}

function artifactRows(): SuggestionArtifactRow[] {
  const common = { artifactVersion: VISUAL_METADATA_ARTIFACT_VERSION, recordedAt: "2026-08-04T00:00:00.000Z", provenance: provenance() };
  return [
    ...Array.from({ length: 19 }, (_, index) => ({
      ...common,
      decision: { version: VISUAL_METADATA_DECISION_VERSION, outcome: "suggested" as const },
      id: `synthetic-${String(index + 1).padStart(2, "0")}`,
      name: `Synthetic template ${index + 1}`,
      screenshotUrl: `https://templates.openlen.com/e2e/${index + 1}.png`,
      metadata: metadata(), error: null,
      evidence: { rawModelResponse: "raw_evidence_should_never_render upstream-secret" },
    })),
    {
      ...common,
      decision: { version: VISUAL_METADATA_DECISION_VERSION, outcome: "failed" as const },
      id: "synthetic-failure", name: "Typed synthetic failure", screenshotUrl: null, metadata: null,
      error: "typed_failure: synthetic input intentionally failed", evidence: { rawModelResponse: "raw_evidence_should_never_render" },
    },
  ];
}

interface Harness {
  directory: string;
  inputPath: string;
  server: RunningReviewServer;
  screenshotSucceeds: { value: boolean };
  close(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "openlen-reviewer-e2e-"));
  const inputPath = join(directory, "synthetic-artifact.json");
  await writeFile(inputPath, `${JSON.stringify(artifactRows(), null, 2)}\n`, "utf8");
  const screenshotSucceeds = { value: true };
  const server = await startVisualMetadataReviewServer({
    assets,
    workspaceFactory: (reviewer) => openVisualMetadataReviewWorkspace({
      inputPath,
      sessionPath: join(directory, "session.json"),
      reviewedOutputPath: join(directory, "reviewed.json"),
      auditOutputPath: join(directory, "audit.json"),
      reviewer,
    }),
    fetchImpl: async () => screenshotSucceeds.value
      ? new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) } })
      : new Response("unavailable", { status: 503, headers: { "content-type": "text/plain" } }),
  });
  return {
    directory, inputPath, server, screenshotSucceeds,
    async close() { await server.close(); await rm(directory, { recursive: true, force: true }); },
  };
}

async function openDesk(page: Page, harness: Harness): Promise<void> {
  await page.goto(harness.server.bootstrapUrl);
  await expect(page.getByRole("heading", { name: "Identify this review session" })).toBeVisible();
  await page.getByLabel("Name").fill(TEST_REVIEWER.name);
  await page.getByLabel("Email").fill(TEST_REVIEWER.email);
  await page.getByRole("button", { name: "Open review session" }).click();
  await expect(page.getByRole("heading", { name: "Synthetic template 1" })).toBeVisible();
}

async function expectScreenshotReady(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /Approve/ })).toBeEnabled();
}

test.describe("template visual metadata reviewer", () => {
  let harness: Harness;

  test.beforeAll(async () => {
    assets = await buildReviewClientAssets({ cwd: process.cwd() });
  });

  test.beforeEach(async () => {
    harness = await startHarness();
  });

  test.afterEach(async ({ context }) => {
    await context.close();
    await harness.close();
  });

  test("reviews every suggestion, resumes, and exports 19 of 20 at the 95 percent gate", async ({ page }) => {
    await openDesk(page, harness);
    await expectScreenshotReady(page);
    await page.getByRole("button", { name: /Approve/ }).click();
    await expect(page.getByRole("heading", { name: "Synthetic template 2" })).toBeVisible();

    await page.goto("about:blank");
    await harness.server.close();
    harness.server = (await startVisualMetadataReviewServer({
      assets,
      workspaceFactory: (reviewer) => openVisualMetadataReviewWorkspace({
        inputPath: harness.inputPath,
        sessionPath: join(harness.directory, "session.json"),
        reviewedOutputPath: join(harness.directory, "reviewed.json"),
        auditOutputPath: join(harness.directory, "audit.json"), reviewer,
      }),
      fetchImpl: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(PNG.byteLength) } }),
    }));
    await page.goto(harness.server.bootstrapUrl);
    await expect(page.getByRole("heading", { name: "Identify this review session" })).toBeVisible();
    await page.getByLabel("Name").fill(TEST_REVIEWER.name);
    await page.getByLabel("Email").fill(TEST_REVIEWER.email);
    await page.getByRole("button", { name: "Open review session" }).click();
    await expect(page.getByText("1/19 decisions")).toBeVisible();

    for (let index = 2; index <= 19; index += 1) {
      await expectScreenshotReady(page);
      await page.getByRole("button", { name: /Approve/ }).click();
    }
    await expect(page.getByText("Ready to export")).toBeVisible();
    await page.getByRole("button", { name: "Export reviewed artifact" }).click();
    await expect.poll(() => readdir(harness.directory)).toEqual(expect.arrayContaining(["reviewed.json", "audit.json"]));
  });

  test("cannot approve before the screenshot proxy succeeds", async ({ page }) => {
    harness.screenshotSucceeds.value = false;
    await openDesk(page, harness);
    await expect(page.getByText("Screenshot unavailable. Approval remains disabled.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve/ })).toBeDisabled();
    harness.screenshotSucceeds.value = true;
    await page.getByRole("button", { name: "Retry screenshot" }).click();
    await expectScreenshotReady(page);
  });

  test("requires rejection reason and reports the exact gate shortfall", async ({ page }) => {
    await openDesk(page, harness);
    await page.getByRole("button", { name: /Reject/ }).click();
    await page.getByRole("button", { name: "Reject proposal" }).click();
    await expect(page.getByText("Enter a rejection reason.")).toBeVisible();
    await page.getByLabel("Rejection reason").fill("Screenshot does not support the suggestion.");
    await page.getByRole("button", { name: "Reject proposal" }).click();
    await expect(page.locator(".completion-panel").getByText("19 approvals still needed")).toBeVisible();
    await expect(page.locator(".completion-panel").getByText("18 decisions still needed")).toBeVisible();
  });

  test("supports the keyboard-only critical path", async ({ page }) => {
    await openDesk(page, harness);
    await expectScreenshotReady(page);
    await page.keyboard.press("a");
    await expect(page.getByRole("heading", { name: "Synthetic template 2" })).toBeVisible();
    await page.keyboard.press("r");
    await expect(page.getByRole("dialog", { name: "Reject this proposal" })).toBeVisible();
    await page.getByLabel("Rejection reason").fill("Keyboard review rejection.");
    await page.getByRole("button", { name: "Reject proposal" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Synthetic template 3" })).toBeVisible();
    await page.keyboard.press("j");
    await expect(page.getByRole("heading", { name: "Synthetic template 4" })).toBeVisible();
    await page.keyboard.press("k");
    await expect(page.getByRole("heading", { name: "Synthetic template 3" })).toBeVisible();
    await page.keyboard.press("e");
    await expect(page.getByRole("complementary", { name: "Metadata inspector" })).toBeFocused();
  });

  test("never exposes raw evidence or reviewer email in API responses or DOM", async ({ page }) => {
    await openDesk(page, harness);
    const apiText = await (await page.request.get(`${harness.server.origin}/api/items`)).text();
    const body = await page.locator("body").innerText();
    for (const marker of PRIVATE_MARKERS) {
      expect(apiText).not.toContain(marker);
      expect(body).not.toContain(marker);
    }
    expect(apiText).not.toContain(TEST_REVIEWER.email);
    expect(body).not.toContain(TEST_REVIEWER.email);
  });

  test("matches the approved desktop inspection desk", async ({ page }) => {
    await openDesk(page, harness);
    await expectScreenshotReady(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeFocused();
    await expect(page).toHaveScreenshot("reviewer-desktop.png", { fullPage: true });
  });

  test("matches the approved narrow stacked layout", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await openDesk(page, harness);
    await expectScreenshotReady(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeFocused();
    await expect(page.locator(".workspace")).toHaveCSS("grid-template-columns", "600px");
    await expect(page).toHaveScreenshot("reviewer-narrow.png", { fullPage: true });
  });
});
