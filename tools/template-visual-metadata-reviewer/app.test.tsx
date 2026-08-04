import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ReviewerApi,
  SafeReviewItemDto,
  SafeReviewSessionDto,
} from "./api";
import { ReviewerApp } from "./app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const METADATA = {
  schemaVersion: "template-visual-metadata/1.0" as const,
  domains: ["saas"],
  audiences: ["businesses"],
  ageRanges: ["adult"],
  emotionalRegisters: ["technical"],
  visualArchetypes: ["technical_minimal"],
  visualSignals: ["saas_dashboard"],
  layoutTraits: ["dense"],
  requiredAssetTypes: ["product_mockup"],
  supportedSiteTypes: ["product_landing"],
  supportedSectionRoles: ["hero", "features"],
  negativeTags: ["children"],
  themeability: "medium" as const,
  identityStrength: "high" as const,
  reviewStatus: "unreviewed" as const,
};

const SESSION: SafeReviewSessionDto = {
  phase: "review",
  reviewerName: "Ada Reviewer",
  source: {
    artifactVersion: "template-visual-metadata-suggestion-artifact/1.0",
    abbreviatedSha256: "aaaaaaaaaaaa",
  },
  progress: {
    total: 450,
    suggested: 440,
    failed: 10,
    pending: 438,
    approved: 1,
    rejected: 1,
    requiredApprovals: 428,
    remainingApprovals: 427,
    finalExportEnabled: false,
  },
  currentTemplateId: "one",
};

function item(
  id: string,
  state: SafeReviewItemDto["state"] = "pending",
  overrides: Partial<SafeReviewItemDto> = {},
): SafeReviewItemDto {
  return {
    id,
    name: `Template ${id}`,
    screenshotEndpoint: `/api/items/${id}/screenshot`,
    metadata: structuredClone(METADATA),
    failureKind: null,
    state,
    ...overrides,
  };
}

function makeApi(
  overrides: Partial<ReviewerApi> = {},
): ReviewerApi {
  return {
    getSession: vi.fn(async () => SESSION),
    submitIdentity: vi.fn(async () => SESSION),
    getItems: vi.fn(async () => [item("one"), item("two"), item("approved", "approved"), item("rejected", "rejected"), item("failed", "failed", {
      screenshotEndpoint: null,
      metadata: null,
      failureKind: "model_timeout",
    })]),
    updateMetadata: vi.fn(async () => SESSION),
    decide: vi.fn(async () => SESSION),
    reopen: vi.fn(async () => SESSION),
    navigate: vi.fn(async () => undefined),
    exportFinal: vi.fn(async () => ({ exported: true as const })),
    exportAudit: vi.fn(async () => ({ exported: true as const })),
    ...overrides,
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(api = makeApi()) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<ReviewerApp api={api} />);
  });
  return { api, host };
}

async function click(element: Element | null) {
  if (!(element instanceof HTMLElement)) throw new Error("Expected an HTML element");
  await act(async () => element.click());
}

async function input(element: Element | null, value: string) {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
    throw new Error("Expected an input or textarea");
  }
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(key: string, target: Element = document.body) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function loadScreenshot() {
  const image = host!.querySelector("img");
  if (!image) throw new Error("Expected screenshot");
  await act(async () => image.dispatchEvent(new Event("load")));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe("template visual metadata reviewer", () => {
  it("renders the screenshot stage and metadata inspector from the safe DTO", async () => {
    await render();
    expect(host!.querySelector("[aria-label='Screenshot inspection stage']")).not.toBeNull();
    expect(host!.querySelector("img")?.getAttribute("alt")).toBe("Full-page screenshot of Template one");
    expect(host!.querySelector("aside")?.textContent).toContain("Domains and audiences");
    expect(host!.textContent).toContain("Ada Reviewer");
    expect(host!.textContent).toContain("one");
  });

  it("shows a blocking identity form before requesting any review item", async () => {
    const api = makeApi({
      getSession: vi.fn(async (): Promise<SafeReviewSessionDto> => ({ phase: "identity_required" })),
    });
    await render(api);
    expect(host!.querySelector("[role='dialog'][aria-modal='true']")).not.toBeNull();
    expect(api.getItems).not.toHaveBeenCalled();

    await input(host!.querySelector("input[name='name']"), "Grace Reviewer");
    await input(host!.querySelector("input[name='email']"), "grace@example.test");
    await click(host!.querySelector("button[type='submit']"));
    expect(api.submitIdentity).toHaveBeenCalledWith({
      name: "Grace Reviewer",
      email: "grace@example.test",
    });
    expect(api.getItems).toHaveBeenCalledTimes(1);
    expect(host!.textContent).not.toContain("grace@example.test");
  });

  it("disables approval until the screenshot load event and valid metadata", async () => {
    await render();
    const approve = host!.querySelector<HTMLButtonElement>("button[data-action='approve']");
    expect(approve?.disabled).toBe(true);
    const failedImage = host!.querySelector("img")!;
    await act(async () => failedImage.dispatchEvent(new Event("error")));
    await click(host!.querySelector(".stage-message button"));
    expect(host!.querySelector("img")).not.toBe(failedImage);
    expect(approve?.disabled).toBe(true);
    await loadScreenshot();
    expect(approve?.disabled).toBe(false);

    const metadata = structuredClone(METADATA);
    metadata.domains = [];
    await act(async () => {
      root!.render(<ReviewerApp api={makeApi({ getItems: vi.fn(async () => [item("one", "pending", { metadata })]) })} />);
    });
    await loadScreenshot();
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='approve']")?.disabled).toBe(true);
  });

  it("commits snake_case chip edits and shows validation errors", async () => {
    const api = makeApi();
    await render(api);
    const editor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']");
    await input(editor, "design systems");
    await key("Enter", editor!);
    expect(host!.textContent).toContain("Use lowercase snake_case");
    expect(api.updateMetadata).not.toHaveBeenCalled();

    await input(editor, "design_systems");
    await key("Enter", editor!);
    expect(api.updateMetadata).toHaveBeenCalledWith("one", "domains", ["saas", "design_systems"]);
    expect(host!.textContent).toContain("design_systems");
  });

  it("requires rejection reason and advances after a successful decision", async () => {
    const api = makeApi();
    await render(api);
    await click(host!.querySelector("button[data-action='reject']"));
    const dialog = host!.querySelector("[role='dialog']");
    expect(dialog).not.toBeNull();
    await click(dialog!.querySelector("button[data-confirm-reject]"));
    expect(dialog!.textContent).toContain("Enter a rejection reason");
    expect(api.decide).not.toHaveBeenCalled();

    await input(dialog!.querySelector("textarea"), "Screenshot does not support these tags");
    await click(dialog!.querySelector("button[data-confirm-reject]"));
    expect(api.decide).toHaveBeenCalledWith("one", {
      action: "rejected",
      reason: "Screenshot does not support these tags",
    });
    expect(api.navigate).toHaveBeenCalledWith("two");
  });

  it("supports A R J K E and Esc but suppresses shortcuts in editors", async () => {
    const api = makeApi();
    await render(api);
    await loadScreenshot();

    await key("e");
    expect(host!.querySelector("aside")?.contains(document.activeElement)).toBe(true);
    await key("j");
    expect(api.navigate).toHaveBeenLastCalledWith("two");
    await key("k");
    expect(api.navigate).toHaveBeenLastCalledWith("one");
    await loadScreenshot();
    await key("r");
    expect(host!.querySelector("[role='dialog']")).not.toBeNull();
    await key("Escape");
    expect(host!.querySelector("[role='dialog']")).toBeNull();
    await key("a");
    expect(api.decide).toHaveBeenCalledWith("one", { action: "approved" });

    const editor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")!;
    const calls = vi.mocked(api.navigate).mock.calls.length;
    await key("j", editor);
    await key("r", editor);
    expect(vi.mocked(api.navigate).mock.calls).toHaveLength(calls);
    expect(host!.querySelector("[role='dialog']")).toBeNull();
  });

  it("filters pending approved rejected failed and searches id name or tag", async () => {
    const api = makeApi();
    await render(api);
    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const queue = host!.querySelector("#review-queue")!;
    for (const status of ["pending", "approved", "rejected", "failed"]) {
      await click(queue.querySelector(`button[data-filter='${status}']`));
      expect(api.getItems).toHaveBeenLastCalledWith({ status, q: undefined });
    }
    const search = queue.querySelector("input[type='search']");
    await input(search, "saas");
    expect(api.getItems).toHaveBeenLastCalledWith({ status: "failed", q: "saas" });
  });

  it("shows exact remaining approvals and completion gate state", async () => {
    const api = makeApi();
    await render(api);
    expect(host!.textContent).toContain("427 approvals still needed");
    expect(host!.textContent).toContain("438 decisions still needed");
    expect(host!.querySelector<HTMLButtonElement>("button[data-export-final]")?.disabled).toBe(true);
    expect(host!.querySelector<HTMLButtonElement>("button[data-export-audit]")?.disabled).toBe(false);
  });

  it("never renders reviewer email or raw evidence", async () => {
    const unsafe = {
      ...item("one"),
      evidence: { rawModelResponse: "RAW_MODEL_SECRET" },
      reviewerEmail: "ada@example.test",
      screenshotUrl: "https://templates.openlen.com/private/source.jpg",
      sourcePath: "C:\\private\\artifact.json",
    } as SafeReviewItemDto;
    await render(makeApi({ getItems: vi.fn(async () => [unsafe]) }));
    const serialized = document.body.textContent + document.body.innerHTML;
    for (const secret of [
      "RAW_MODEL_SECRET",
      "rawModelResponse",
      "ada@example.test",
      "source.jpg",
      "C:\\private",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
