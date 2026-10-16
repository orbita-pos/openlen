// NOTHING CHARGES WITHOUT THE LEDGER (spec local 2026-10-16-credit-ledger, §1.4).
//
// Every movement of `users.credits` goes through chargeCredits /
// chargeCreditsIfEnough / returnCredits, which write the `creditLedger` row in
// the same statement. The old debitCredits / debitCreditsIfEnough /
// refundCredits stay inside lib/credits.ts only as the fallback for a failed
// ledger statement: exported, a new charge site could skip the ledger and
// nothing would turn red.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {}, schema: { users: {} } }));

import * as credits from "@/lib/credits";

const OLD = ["debitCredits", "debitCreditsIfEnough", "refundCredits"] as const;
const ROOT = process.cwd();
const ALLOWED = new Set([join("lib", "credits.ts"), join("lib", "credit-ledger.ts")]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

describe("nothing outside lib/credits.ts charges without the ledger", () => {
  it("the old debit functions are not exported", () => {
    for (const name of OLD) expect(credits, name).not.toHaveProperty(name);
  });

  it("no source file calls or imports them", () => {
    const pattern = new RegExp(`\\b(${OLD.join("|")})\\s*[(,}]`);
    const offenders = [...sources("app"), ...sources("lib")]
      .filter((f) => !ALLOWED.has(f))
      .filter((f) =>
        readFileSync(join(ROOT, f), "utf8")
          .split("\n")
          // Comments may still name them (history); code may not.
          .some((line) => !/^\s*(\/\/|\*)/.test(line) && pattern.test(line)),
      );
    expect(offenders).toEqual([]);
  });
});
