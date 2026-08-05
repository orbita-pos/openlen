import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ReviewerApi,
  SafeReviewItemDto,
  SafeReviewSessionDto,
} from "./api";
import { ReviewerApiError } from "./api";
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

async function key(
  key: string,
  target: Element = document.body,
  options: Pick<KeyboardEventInit, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat"> = {},
) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
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

  it("discards chip draft and error when navigation changes the template", async () => {
    const api = makeApi();
    await render(api);
    const editor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")!;
    await input(editor, "invalid draft");
    await key("Enter", editor);
    expect(host!.textContent).toContain("Use lowercase snake_case");
    await input(editor, "one_only");

    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const toTwo = [...host!.querySelectorAll<HTMLButtonElement>("#review-queue li button")]
      .find((button) => button.textContent?.includes("Template two"))!;
    await click(toTwo);

    const nextEditor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")!;
    expect(nextEditor.value).toBe("");
    expect(host!.textContent).not.toContain("Use lowercase snake_case");
    await key("Enter", nextEditor);
    expect(api.updateMetadata).not.toHaveBeenCalled();
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

  it("traps rejection focus and blocks every dismissal path while commit is busy", async () => {
    const decision = deferred<SafeReviewSessionDto>();
    const api = makeApi({
      decide: vi.fn(async () => decision.promise),
    });
    await render(api);
    const rejectButton = host!.querySelector<HTMLElement>("button[data-action='reject']")!;
    rejectButton.focus();
    await click(rejectButton);
    const dialog = host!.querySelector<HTMLElement>("[role='dialog']")!;
    const close = dialog.querySelector<HTMLButtonElement>("button[aria-label='Close dialog']")!;
    const confirm = dialog.querySelector<HTMLButtonElement>("button[data-confirm-reject]")!;
    const cancel = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Cancel")!;

    confirm.focus();
    await key("Tab", confirm);
    expect(document.activeElement).toBe(close);
    await key("Tab", close, { shiftKey: true });
    expect(document.activeElement).toBe(confirm);

    await input(dialog.querySelector("textarea"), "Unsupported composition");
    await click(confirm);
    expect(confirm.disabled).toBe(true);
    expect(close.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    await key("Escape");
    expect(host!.querySelector("[role='dialog']")).not.toBeNull();
    await click(host!.querySelector(".dialog-backdrop"));
    expect(host!.querySelector("[role='dialog']")).not.toBeNull();

    decision.resolve(SESSION);
    await act(async () => decision.promise);
    expect(host!.querySelector("[role='dialog']")).toBeNull();
    expect(document.activeElement).toBe(rejectButton);
  });

  it("keeps a failed rejection actionable without exposing its cause", async () => {
    const api = makeApi({
      decide: vi.fn(async () => {
        throw new ReviewerApiError("command_invalid", 400);
      }),
    });
    await render(api);
    await click(host!.querySelector("button[data-action='reject']"));
    const dialog = host!.querySelector<HTMLElement>("[role='dialog']")!;
    await input(dialog.querySelector("textarea"), "Keep this reason");
    await click(dialog.querySelector("button[data-confirm-reject]"));

    expect(host!.querySelector("[role='dialog']")).not.toBeNull();
    expect(host!.querySelector<HTMLTextAreaElement>("[role='dialog'] textarea")?.value).toBe("Keep this reason");
    expect(host!.querySelector<HTMLButtonElement>("[data-confirm-reject]")?.disabled).toBe(false);
    expect(host!.querySelector("[role='dialog']")?.textContent).toContain("The operation failed");
    expect(host!.textContent).not.toContain("command_invalid");
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

  it("ignores held or modified shortcuts and never chains approval into the next row", async () => {
    const api = makeApi();
    await render(api);
    await loadScreenshot();
    for (const options of [
      { repeat: true },
      { shiftKey: true },
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
    ]) {
      await key("a", document.body, options);
      await key("r", document.body, options);
    }
    expect(api.decide).not.toHaveBeenCalled();
    expect(host!.querySelector("[role='dialog']")).toBeNull();

    await key("a");
    expect(api.decide).toHaveBeenCalledTimes(1);
    expect(host!.querySelector("img")?.getAttribute("alt")).toBe("Full-page screenshot of Template two");
    await loadScreenshot();
    await key("a", document.body, { repeat: true });
    expect(api.decide).toHaveBeenCalledTimes(1);
  });

  it("binds screenshot success to the exact item and attempt before passive effects", async () => {
    const navigation = deferred<void>();
    const api = makeApi({
      navigate: vi.fn(() => navigation.promise),
    });
    await render(api);
    const priorImage = host!.querySelector("img")!;
    await loadScreenshot();
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='approve']")?.disabled).toBe(false);

    await key("j");
    await act(async () => {
      navigation.resolve();
      await vi.mocked(api.navigate).mock.results[0].value;
      await Promise.resolve();
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      await Promise.resolve();
    });

    expect(api.decide).not.toHaveBeenCalled();
    expect(host!.querySelector("h1")?.textContent).toBe("Template two");
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='approve']")?.disabled).toBe(true);
    await act(async () => priorImage.dispatchEvent(new Event("load", { bubbles: true })));
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='approve']")?.disabled).toBe(true);
    await loadScreenshot();
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='approve']")?.disabled).toBe(false);
  });

  it("keeps decided rows read-only and exposes reopen as the only transition", async () => {
    const api = makeApi({
      getItems: vi.fn(async () => [
        item("one", "approved", {
          metadata: { ...structuredClone(METADATA), reviewStatus: "reviewed" },
        }),
      ]),
    });
    await render(api);
    await loadScreenshot();

    expect(host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")?.disabled).toBe(true);
    expect(host!.querySelector<HTMLSelectElement>("select")?.disabled).toBe(true);
    expect(host!.querySelector("button[data-action='approve']")).toBeNull();
    expect(host!.querySelector("button[data-action='reject']")).toBeNull();
    await key("a");
    await key("r");
    expect(api.decide).not.toHaveBeenCalled();
    expect(host!.querySelector("[role='dialog']")).toBeNull();

    await click(host!.querySelector(".reopen-button"));
    expect(api.reopen).toHaveBeenCalledWith("one");
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

  it("commits only the newest targeted navigation response", async () => {
    const navigations = {
      two: deferred<void>(),
      approved: deferred<void>(),
    };
    const api = makeApi({
      navigate: vi.fn(async (id: string) => navigations[id as keyof typeof navigations].promise),
    });
    await render(api);
    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const buttons = [...host!.querySelectorAll<HTMLButtonElement>("#review-queue li button")];
    const toTwo = buttons.find((button) => button.textContent?.includes("Template two"))!;
    const toApproved = buttons.find((button) => button.textContent?.includes("Template approved"))!;
    await click(toTwo);
    await click(toApproved);

    navigations.approved.resolve();
    await act(async () => navigations.approved.promise);
    expect(host!.querySelector("h1")?.textContent).toBe("Template approved");
    navigations.two.resolve();
    await act(async () => navigations.two.promise);
    expect(host!.querySelector("h1")?.textContent).toBe("Template approved");
  });

  it("locks queue controls during mutation and refreshes with the latest query", async () => {
    const update = deferred<SafeReviewSessionDto>();
    const api = makeApi({
      updateMetadata: vi.fn(async () => update.promise),
      getItems: vi.fn(async ({ q }) => q === "saas"
        ? [item("tagged", "pending", { name: "SaaS tagged result" })]
        : [item("one"), item("two")]),
    });
    await render(api);
    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const search = host!.querySelector<HTMLInputElement>("#review-queue input[type='search']")!;
    const editor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")!;
    await input(editor, "new_domain");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "saas");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });

    expect(search.disabled).toBe(true);
    expect(host!.querySelector<HTMLButtonElement>("button[data-filter='pending']")?.disabled).toBe(true);
    update.resolve(SESSION);
    await act(async () => update.promise);
    expect(host!.querySelector("#review-queue")?.textContent).toContain("SaaS tagged result");
    expect(host!.querySelector("#review-queue")?.textContent).not.toContain("Template two");
  });

  it("renders fixed filter errors and safe tag-search results", async () => {
    let failNext = false;
    const api = makeApi({
      getItems: vi.fn(async ({ q }) => {
        if (failNext) throw new ReviewerApiError("private_filter_cause", 500);
        if (q === "technical") {
          return [item("technical-result", "pending", {
            name: "Technical result",
            metadata: { ...structuredClone(METADATA), domains: ["technical_tag"] },
          })];
        }
        return [item("one"), item("two")];
      }),
    });
    await render(api);
    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const search = host!.querySelector<HTMLInputElement>("#review-queue input[type='search']")!;
    await input(search, "technical");
    expect(host!.querySelector("#review-queue")?.textContent).toContain("Technical result");
    expect(host!.textContent).toContain("technical_tag");

    failNext = true;
    await click(host!.querySelector("button[data-filter='pending']"));
    await act(async () => Promise.resolve());
    expect(host!.querySelector("[role='alert']")?.textContent).toContain("The operation failed");
    expect(host!.textContent).not.toContain("private_filter_cause");
  });

  it("freezes mutation and navigation after a terminal session-save failure", async () => {
    const api = makeApi({
      decide: vi.fn(async () => {
        throw new ReviewerApiError("request_rejected", 500);
      }),
    });
    await render(api);
    await loadScreenshot();
    await click(host!.querySelector("button[data-action='approve']"));

    const paused = host!.querySelector("[data-review-paused]");
    expect(paused?.textContent).toContain("Review paused");
    expect(paused?.textContent).toContain("Reload this local reviewer");
    expect(paused?.textContent).toContain("exit and restart");
    expect(host!.textContent).not.toContain("request_rejected");
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='approve']")?.disabled).toBe(true);
    expect(host!.querySelector<HTMLButtonElement>("button[data-action='reject']")?.disabled).toBe(true);

    await click(host!.querySelector("button[aria-controls='review-queue']"));
    expect(host!.querySelector<HTMLInputElement>("#review-queue input[type='search']")?.disabled).toBe(true);
    expect(host!.querySelector<HTMLButtonElement>("button[data-filter='pending']")?.disabled).toBe(true);
    const navigationCalls = vi.mocked(api.navigate).mock.calls.length;
    await key("j");
    expect(vi.mocked(api.navigate).mock.calls).toHaveLength(navigationCalls);
  });

  it("revokes a pending navigation when a mutation terminally pauses the review", async () => {
    const navigation = deferred<void>();
    const api = makeApi({
      navigate: vi.fn(() => navigation.promise),
      updateMetadata: vi.fn(async () => {
        throw new ReviewerApiError("request_rejected", 500);
      }),
    });
    await render(api);
    await loadScreenshot();
    const exactImage = host!.querySelector("img");
    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const toTwo = [...host!.querySelectorAll<HTMLButtonElement>("#review-queue li button")]
      .find((button) => button.textContent?.includes("Template two"))!;
    await click(toTwo);

    const editor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")!;
    await input(editor, "terminal_edit");
    await key("Enter", editor);
    expect(host!.querySelector("[data-review-paused]")).not.toBeNull();
    expect(host!.querySelector("h1")?.textContent).toBe("Template one");
    expect(host!.querySelector("img")).toBe(exactImage);
    expect(host!.querySelector(".stage-message")).toBeNull();

    navigation.resolve();
    await act(async () => {
      await vi.mocked(api.navigate).mock.results[0].value;
      await Promise.resolve();
    });
    expect(host!.querySelector("[data-review-paused]")).not.toBeNull();
    expect(host!.querySelector("h1")?.textContent).toBe("Template one");
    expect(host!.querySelector("img")).toBe(exactImage);
    expect(host!.querySelector(".stage-message")).toBeNull();
  });

  it("revokes a pending item query when a mutation terminally pauses the review", async () => {
    const query = deferred<SafeReviewItemDto[]>();
    const api = makeApi({
      getItems: vi.fn(async ({ q }) => q === "late" ? query.promise : [item("one"), item("two")]),
      updateMetadata: vi.fn(async () => {
        throw new ReviewerApiError("request_rejected", 500);
      }),
    });
    await render(api);
    await loadScreenshot();
    await click(host!.querySelector("button[aria-controls='review-queue']"));
    const queueBefore = host!.querySelector("#review-queue")?.textContent;
    const exactImage = host!.querySelector("img");
    const search = host!.querySelector<HTMLInputElement>("#review-queue input[type='search']")!;
    await input(search, "late");

    const editor = host!.querySelector<HTMLInputElement>("input[aria-label='Add domains tag']")!;
    await input(editor, "terminal_edit");
    await key("Enter", editor);
    expect(host!.querySelector("[data-review-paused]")).not.toBeNull();
    expect(host!.querySelector("h1")?.textContent).toBe("Template one");
    expect(host!.querySelector("#review-queue")?.textContent).toBe(queueBefore);
    expect(host!.querySelector("img")).toBe(exactImage);

    query.resolve([item("late-result", "pending", { name: "Late query result" })]);
    await act(async () => {
      await query.promise;
      await Promise.resolve();
    });
    expect(host!.querySelector("[data-review-paused]")).not.toBeNull();
    expect(host!.querySelector("h1")?.textContent).toBe("Template one");
    expect(host!.querySelector("#review-queue")?.textContent).toBe(queueBefore);
    expect(host!.querySelector("#review-queue")?.textContent).not.toContain("Late query result");
    expect(host!.querySelector("img")).toBe(exactImage);
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
