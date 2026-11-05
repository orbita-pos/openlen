// A «CREAR» CARD FROM OUTSIDE (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): what the stream or the server
// gives, read field by field — it comes from outside. The workspace's chat and, since phase 5, the phone app read cards
// with it. Pure, client-safe.
import type { ToolCardPhase, ToolCardReview, ToolCardView } from "./types";

export const TOOL_CARD_PHASES: readonly ToolCardPhase[] = ["proposed", "dismissed", "replaced", "creating", "installing", "installed", "removed", "failed", "cancelled", "interrupted", "needs_review"];

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? v.slice(0, max) : null);

function reviewFrom(v: unknown): ToolCardReview | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const fingerprint = str(o.fingerprint, 200);
  if ((o.kind !== "security_findings" && o.kind !== "needs_confirmation") || !fingerprint) return null;
  const findings = Array.isArray(o.findings) ? o.findings.flatMap((f) => str(f, 500) ?? []) : [];
  return { kind: o.kind, fingerprint, findings };
}

/** A card as the stream or the server gives it, field by field: it comes from outside. */
export function toolCardFrom(v: unknown): ToolCardView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = str(o.id, 64);
  const chatRowId = str(o.chatRowId, 64);
  const phase = TOOL_CARD_PHASES.includes(o.phase as ToolCardPhase) ? (o.phase as ToolCardPhase) : null;
  if (!id || !chatRowId || !phase) return null;
  return {
    id,
    chatRowId,
    title: str(o.title, 200) ?? "",
    brief: str(o.brief, 20_000) ?? "",
    initialContent: str(o.initialContent, 100_000),
    placement: o.placement === "project" ? "project" : "rail",
    customLocation: str(o.customLocation, 1_000),
    phase,
    toolProjectId: str(o.toolProjectId, 64),
    installationId: str(o.installationId, 64),
    error: str(o.error, 2_000),
    review: reviewFrom(o.review),
  };
}
