import { describe, expect, it } from "vitest";

import { parseFilter, parseScan } from "./parse";

const one = { file: "/supabase/functions/x/index.ts", line: 3, severity: "HIGH", category: "missing_authorization", description: "d", exploit_scenario: "e", recommendation: "r", confidence: 0.9 };

describe("parseScan", () => {
  it("reads bare JSON", () => {
    expect(parseScan(JSON.stringify({ findings: [one] }))).toEqual([one]);
  });

  it("reads it inside a code fence with a line of prose around it", () => {
    expect(parseScan(`Here is the report:\n\`\`\`json\n${JSON.stringify({ findings: [one] })}\n\`\`\`\nDone.`)).toEqual([one]);
  });

  it("tolerates the trailing comma copied from an example", () => {
    expect(parseScan(`{"findings": [${JSON.stringify(one)},], "analysis_summary": {"review_completed": true,}}`)).toEqual([one]);
  });

  it("normalizes: a path without its slash, a 1-10 confidence, a line that isn't a number, a lowercase severity", () => {
    const [f] = parseScan(JSON.stringify({ findings: [{ ...one, file: "src/a.ts", confidence: 9, line: "12", severity: "medium" }] }))!;
    expect(f).toMatchObject({ file: "/src/a.ts", confidence: 0.9, line: null, severity: "MEDIUM" });
  });

  it("drops an entry without a file, a description or a valid severity, and keeps the rest", () => {
    const got = parseScan(JSON.stringify({ findings: [one, { ...one, file: "" }, { ...one, description: " " }, { ...one, severity: "CRITICAL" }] }));
    expect(got).toEqual([one]);
  });

  it("an empty list is an answer: nothing found", () => {
    expect(parseScan('{"findings": []}')).toEqual([]);
  });

  it("anything else is null", () => {
    expect(parseScan("No issues found.")).toBeNull();
    expect(parseScan('{"findings": "none"}')).toBeNull();
    expect(parseScan("{broken")).toBeNull();
  });
});

describe("parseFilter", () => {
  it("reads the score and whether to keep it", () => {
    expect(parseFilter('{"original_severity":"HIGH","confidence_score":9,"keep_finding":true,"exclusion_reason":null,"justification":"x"}')).toEqual({ score: 9, keep: true });
    expect(parseFilter('```json\n{"confidence_score": "3", "keep_finding": false}\n```')).toEqual({ score: 3, keep: false });
  });

  it("is null without a score", () => {
    expect(parseFilter('{"keep_finding": true}')).toBeNull();
    expect(parseFilter("I think it's real.")).toBeNull();
  });
});
