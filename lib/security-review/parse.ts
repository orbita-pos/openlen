// lib/security-review/parse.ts — reading what the reviewer answered.

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
