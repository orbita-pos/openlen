import { expect, test, type Page } from "@playwright/test";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewClientAssets } from "../../lib/templates/visual-metadata-review-launcher";
import { openVisualMetadataReviewWorkspace } from "../../lib/templates/visual-metadata-review-session-store";
import { startVisualMetadataReviewServer, type RunningReviewServer } from "../../lib/templates/visual-metadata-review-server";
import {
  VISUAL_METADATA_ARTIFACT_VERSION,
  VISUAL_METADATA_DECISION_VERSION,
  type SuggestionArtifactRow,
} from "../../lib/templates/visual-metadata-suggestion-contract";
import type { ReviewClientAssets } from "../../lib/templates/visual-metadata-review-server";
import {
  REVIEW_AUDIT_VERSION,
  REVIEW_SESSION_VERSION,
  ReviewEventV1Schema,
} from "../../lib/templates/visual-metadata-review-session";
import { TemplateVisualMetadataSchema } from "../../lib/templates/visual-metadata";

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

function assertFinalExports(reviewedValue: unknown, auditValue: unknown, sourceBytes: Buffer): void {
  if (!Array.isArray(reviewedValue) || reviewedValue.length !== 19) throw new Error("reviewed export must contain 19 approvals");
  const expectedIds = Array.from({ length: 19 }, (_, index) => `synthetic-${String(index + 1).padStart(2, "0")}`);
  const reviewedIds = reviewedValue.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("reviewed export entry must be an object");
    const candidate = entry as { id?: unknown; metadata?: unknown };
    if (typeof candidate.id !== "string" || !TemplateVisualMetadataSchema.safeParse(candidate.metadata).success
      || (candidate.metadata as { reviewStatus?: unknown }).reviewStatus !== "reviewed") {
      throw new Error("reviewed export entry must be reviewed metadata");
    }
    return candidate.id;
  });
  if (JSON.stringify(reviewedIds) !== JSON.stringify(expectedIds)) throw new Error("reviewed export IDs must match approved suggestions");
  if (!auditValue || typeof auditValue !== "object" || Array.isArray(auditValue)) throw new Error("audit export must be an object");
  const audit = auditValue as Record<string, unknown>;
  const source = audit.source as Record<string, unknown> | null;
  const reviewer = audit.reviewer as Record<string, unknown> | null;
  const finalCounts = audit.finalCounts as Record<string, unknown> | null;
  const coverage = audit.coverage as Record<string, unknown> | null;
  const templates = audit.templates as Record<string, Record<string, unknown>> | null;
  if (audit.schemaVersion !== REVIEW_AUDIT_VERSION || audit.sessionSchemaVersion !== REVIEW_SESSION_VERSION
    || !source || source.artifactVersion !== VISUAL_METADATA_ARTIFACT_VERSION
    || source.sha256 !== createHash("sha256").update(sourceBytes).digest("hex")
    || source.rowCount !== 20 || source.suggestedCount !== 19 || source.failedCount !== 1
    || !reviewer || reviewer.name !== TEST_REVIEWER.name || reviewer.email !== TEST_REVIEWER.email
    || typeof audit.sessionStartedAt !== "string"
    || typeof audit.completedAt !== "string" || typeof audit.exportedAt !== "string"
    || Date.parse(audit.completedAt) < Date.parse(audit.sessionStartedAt)
    || Date.parse(audit.exportedAt) < Date.parse(audit.completedAt)
    || !finalCounts || finalCounts.approved !== 19 || finalCounts.rejected !== 0
    || finalCounts.failed !== 1 || finalCounts.pending !== 0
    || !coverage || coverage.numerator !== 19 || coverage.denominator !== 20 || coverage.fraction !== "19/20"
    || !templates || Object.keys(templates).length !== 20
    || templates["synthetic-01"]?.state !== "approved"
    || (templates["synthetic-01"]?.metadata as Record<string, unknown> | null)?.reviewStatus !== "reviewed"
    || templates["synthetic-failure"]?.state !== "failed"
    || templates["synthetic-failure"]?.failureKind !== "unknown"
    || !Array.isArray(audit.events)) {
    throw new Error("audit export source proof is invalid");
  }
  const events = audit.events.map((event) => ReviewEventV1Schema.parse(event));
  if (events.length !== 19 || events.some((event, index) => event.sequence !== index + 1 || event.action !== "approved")
    || JSON.stringify(events.map((event) => event.templateId)) !== JSON.stringify(expectedIds)) {
    throw new Error("audit export must cover every approved decision");
  }
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
    const durableSession = JSON.parse(await readFile(join(harness.directory, "session.json"), "utf8")) as Record<string, unknown>;
    const durableSource = durableSession.source as Record<string, unknown>;
    const durableEvents = durableSession.events as Array<Record<string, unknown>>;
    expect(durableSession).toMatchObject({
      schemaVersion: REVIEW_SESSION_VERSION,
      currentTemplateId: "synthetic-02",
    });
    expect(durableSource).toMatchObject({ rowCount: 20, suggestedCount: 19, failedCount: 1 });
    expect(durableEvents[0]).toMatchObject({
      schemaVersion: "template-visual-metadata-review-event/1.0",
      action: "approved",
    });
    expect(durableEvents[0].eventId).toMatch(/^[0-9a-f-]{36}$/);

    const context = page.context();
    await page.close();
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
    page = await context.newPage();
    await page.goto(harness.server.bootstrapUrl);
    await expect(page.getByRole("heading", { name: "Identify this review session" })).toBeVisible();
    await page.getByLabel("Name").fill(TEST_REVIEWER.name);
    await page.getByLabel("Email").fill(TEST_REVIEWER.email);
    await page.getByRole("button", { name: "Open review session" }).click();
    await expect(page.getByRole("heading", { name: "Synthetic template 2" })).toBeVisible();
    await expect(page.getByText("1/19 decisions")).toBeVisible();

    for (let index = 2; index <= 19; index += 1) {
      await expectScreenshotReady(page);
      await page.getByRole("button", { name: /Approve/ }).click();
    }
    await expect(page.getByText("Ready to export")).toBeVisible();
    await page.getByRole("button", { name: "Export reviewed artifact" }).click();
    await expect.poll(() => readdir(harness.directory)).toEqual(expect.arrayContaining(["reviewed.json", "audit.json"]));
    const [sourceBytes, reviewedText, auditText] = await Promise.all([
      readFile(harness.inputPath),
      readFile(join(harness.directory, "reviewed.json"), "utf8"),
      readFile(join(harness.directory, "audit.json"), "utf8"),
    ]);
    const reviewed = JSON.parse(reviewedText) as unknown;
    const audit = JSON.parse(auditText) as unknown;
    expect(() => assertFinalExports((reviewed as unknown[]).slice(0, 18), audit, sourceBytes))
      .toThrow("reviewed export must contain 19 approvals");
    assertFinalExports(reviewed, audit, sourceBytes);
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
    await expect(page.locator("button[data-action='reject']")).toBeEnabled();
    await page.keyboard.press("r");
    const rejectionDialog = page.getByRole("dialog", { name: "Reject this proposal" });
    await expect(rejectionDialog).toBeVisible();
    await page.getByLabel("Rejection reason").fill("Keyboard review rejection.");
    await page.getByRole("button", { name: "Reject proposal" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Synthetic template 3" })).toBeVisible();
    await expect(rejectionDialog).toBeHidden();
    await expect(page.locator("button[data-action='reject']")).toBeEnabled();
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
