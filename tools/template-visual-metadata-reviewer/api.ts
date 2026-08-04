import {
  TemplateVisualMetadataSchema,
  type TemplateVisualMetadata,
} from "../../lib/templates/visual-metadata";
import type {
  SafeReviewItemDto as ServerSafeReviewItemDto,
  SafeReviewSessionDto as ServerSafeReviewSessionDto,
} from "../../lib/templates/visual-metadata-review-session";

export type SafeReviewItemDto = ServerSafeReviewItemDto;
export type SafeReviewSessionDto = ServerSafeReviewSessionDto;
export type ReviewState = SafeReviewItemDto["state"];
export interface ExportResultDto {
  exported: true;
}

export interface ReviewerApi {
  getSession(): Promise<SafeReviewSessionDto>;
  submitIdentity(reviewer: { name: string; email: string }): Promise<SafeReviewSessionDto>;
  getItems(filters: { status?: ReviewState; q?: string }): Promise<SafeReviewItemDto[]>;
  updateMetadata(id: string, field: string, value: unknown): Promise<SafeReviewSessionDto>;
  decide(id: string, decision: { action: "approved" } | { action: "rejected"; reason: string }): Promise<SafeReviewSessionDto>;
  reopen(id: string): Promise<SafeReviewSessionDto>;
  navigate(id: string): Promise<void>;
  exportFinal(): Promise<ExportResultDto>;
  exportAudit(): Promise<ExportResultDto>;
}

export class ReviewerApiError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "ReviewerApiError";
    this.stack = `${this.name}: ${code}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

const REVIEW_STATES = new Set<ReviewState>(["pending", "approved", "rejected", "failed"]);

function parseProgress(value: unknown) {
  if (!isRecord(value)) throw new ReviewerApiError("response_invalid", 502);
  const total = integer(value.total);
  const suggested = integer(value.suggested);
  const failed = integer(value.failed);
  const pending = integer(value.pending);
  const approved = integer(value.approved);
  const rejected = integer(value.rejected);
  const requiredApprovals = integer(value.requiredApprovals);
  const remainingApprovals = integer(value.remainingApprovals);
  if ([total, suggested, failed, pending, approved, rejected, requiredApprovals, remainingApprovals].some((part) => part === null)
    || typeof value.finalExportEnabled !== "boolean") {
    throw new ReviewerApiError("response_invalid", 502);
  }
  return {
    total: total!,
    suggested: suggested!,
    failed: failed!,
    pending: pending!,
    approved: approved!,
    rejected: rejected!,
    requiredApprovals: requiredApprovals!,
    remainingApprovals: remainingApprovals!,
    finalExportEnabled: value.finalExportEnabled,
  };
}

function parseSession(value: unknown): SafeReviewSessionDto {
  if (!isRecord(value)) throw new ReviewerApiError("response_invalid", 502);
  if (value.phase === "identity_required") return { phase: "identity_required" };
  if (value.phase !== "review" || !isRecord(value.source)) throw new ReviewerApiError("response_invalid", 502);
  const reviewerName = string(value.reviewerName);
  const artifactVersion = string(value.source.artifactVersion);
  const abbreviatedSha256 = string(value.source.abbreviatedSha256);
  const currentTemplateId = value.currentTemplateId === null ? null : string(value.currentTemplateId);
  if (!reviewerName || !artifactVersion || !abbreviatedSha256 || currentTemplateId === null && value.currentTemplateId !== null) {
    throw new ReviewerApiError("response_invalid", 502);
  }
  return {
    phase: "review",
    reviewerName,
    source: { artifactVersion, abbreviatedSha256 },
    progress: parseProgress(value.progress),
    currentTemplateId,
  };
}

function parseMetadata(value: unknown): TemplateVisualMetadata | null {
  if (value === null) return null;
  const parsed = TemplateVisualMetadataSchema.safeParse(value);
  if (!parsed.success) throw new ReviewerApiError("response_invalid", 502);
  return structuredClone(parsed.data);
}

function parseItem(value: unknown): SafeReviewItemDto {
  if (!isRecord(value)) throw new ReviewerApiError("response_invalid", 502);
  const id = string(value.id);
  const name = string(value.name);
  const state = string(value.state);
  const screenshotEndpoint = value.screenshotEndpoint === null ? null : string(value.screenshotEndpoint);
  const failureKind = value.failureKind === null ? null : string(value.failureKind);
  if (!id || !name || !state || !REVIEW_STATES.has(state as ReviewState)
    || screenshotEndpoint === null && value.screenshotEndpoint !== null
    || failureKind === null && value.failureKind !== null) {
    throw new ReviewerApiError("response_invalid", 502);
  }
  return {
    id,
    name,
    state: state as ReviewState,
    screenshotEndpoint,
    failureKind,
    metadata: parseMetadata(value.metadata),
  };
}

function parseItemsEnvelope(value: unknown): SafeReviewItemDto[] {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new ReviewerApiError("response_invalid", 502);
  return value.items.map(parseItem);
}

function parseWorkspaceSession(value: unknown): SafeReviewSessionDto {
  if (!isRecord(value) || !("session" in value)) throw new ReviewerApiError("response_invalid", 502);
  parseItemsEnvelope(value);
  return parseSession(value.session);
}

function parseExport(value: unknown): ExportResultDto {
  if (!isRecord(value) || value.exported !== true) throw new ReviewerApiError("response_invalid", 502);
  return { exported: true };
}

function itemMatchesQuery(item: SafeReviewItemDto, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const tags = item.metadata
    ? Object.values(item.metadata).flatMap((value) => Array.isArray(value) ? value : [])
    : [];
  return item.id.toLocaleLowerCase().includes(normalized)
    || item.name.toLocaleLowerCase().includes(normalized)
    || tags.some((tag) => tag.toLocaleLowerCase().includes(normalized));
}

export function createReviewerApi(fetchImpl: typeof fetch = fetch): ReviewerApi {
  async function request(path: string, init?: RequestInit): Promise<unknown> {
    const response = await fetchImpl(path, init);
    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      throw new ReviewerApiError("response_invalid", response.status);
    }
    if (!response.ok) {
      const code = isRecord(parsed) && typeof parsed.error === "string" ? parsed.error : "request_failed";
      throw new ReviewerApiError(code, response.status);
    }
    return parsed;
  }

  const json = (method: "POST" | "PATCH", body: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    async getSession() {
      return parseSession(await request("/api/session"));
    },
    async submitIdentity(reviewer) {
      return parseSession(await request("/api/identity", json("POST", reviewer)));
    },
    async getItems(filters) {
      const parameters = new URLSearchParams();
      if (filters.status) parameters.set("status", filters.status);
      const suffix = parameters.size ? `?${parameters.toString()}` : "";
      const items = parseItemsEnvelope(await request(`/api/items${suffix}`));
      return filters.q ? items.filter((item) => itemMatchesQuery(item, filters.q!)) : items;
    },
    async updateMetadata(id, field, value) {
      return parseWorkspaceSession(await request(
        `/api/items/${encodeURIComponent(id)}/metadata`,
        json("PATCH", { field, value }),
      ));
    },
    async decide(id, decision) {
      const body = decision.action === "approved"
        ? { decision: "approve" }
        : { decision: "reject", reason: decision.reason };
      return parseWorkspaceSession(await request(
        `/api/items/${encodeURIComponent(id)}/decision`,
        json("POST", body),
      ));
    },
    async reopen(id) {
      return parseWorkspaceSession(await request(`/api/items/${encodeURIComponent(id)}/reopen`, json("POST", {})));
    },
    async navigate(id) {
      parseSession(await request("/api/navigation", json("POST", { templateId: id })));
    },
    async exportFinal() {
      return parseExport(await request("/api/export", json("POST", {})));
    },
    async exportAudit() {
      return parseExport(await request("/api/export/audit", json("POST", {})));
    },
  };
}
