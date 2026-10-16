// lib/security-review/parse.ts — reading what the reviewer answered. The model
// is asked for bare JSON. It sometimes wraps it in a code fence, adds a line of
// prose, or copies the trailing comma of an example, and all three are
// tolerated. Anything else is `null`: the review is then `failed`, which never
// blocks a publish.

export interface RawFinding {
  readonly file: string;
  readonly line: number | null;
  readonly severity: "HIGH" | "MEDIUM" | "LOW";
  readonly category: string;
  readonly description: string;
  readonly exploit_scenario: string;
  readonly recommendation: string;
  /** 0..1, the identifying pass's own confidence. */
  readonly confidence: number;
}

const SEVERITIES: readonly string[] = ["HIGH", "MEDIUM", "LOW"];

function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  const body = text.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try {
    const v = JSON.parse(body) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function finding(v: unknown): RawFinding | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const severity = str(o.severity).toUpperCase();
  const file = str(o.file);
  const description = str(o.description);
  if (!SEVERITIES.includes(severity) || !file || !description) return null;
  let confidence = typeof o.confidence === "number" ? o.confidence : Number(o.confidence);
  if (!Number.isFinite(confidence)) return null;
  if (confidence > 1 && confidence <= 10) confidence /= 10;
  const line = typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0 ? o.line : null;
  return {
    file: file.startsWith("/") ? file : `/${file}`,
    line,
    severity: severity as RawFinding["severity"],
    category: str(o.category) || "other",
    description,
    exploit_scenario: str(o.exploit_scenario),
    recommendation: str(o.recommendation),
    confidence: Math.max(0, Math.min(1, confidence)),
  };
}

export function parseScan(text: string): RawFinding[] | null {
  const o = jsonObject(text);
  if (!o || !Array.isArray(o.findings)) return null;
  return o.findings.map(finding).filter((f): f is RawFinding => f !== null);
}

export function parseFilter(text: string): { readonly score: number; readonly keep: boolean } | null {
  const o = jsonObject(text);
  if (!o) return null;
  const score = typeof o.confidence_score === "number" ? o.confidence_score : Number(o.confidence_score);
  if (o.confidence_score === undefined || !Number.isFinite(score)) return null;
  return { score, keep: o.keep_finding !== false };
}
