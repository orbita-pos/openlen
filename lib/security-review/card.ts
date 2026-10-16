// lib/security-review/card.ts — what Len's publish card gets of the security
// review. The `confirm` event comes from the stream and is read field by field
// (`tarjetaDeConfirmacion`, components/llamada/puente-a-len.ts): a field that
// reading doesn't know is dropped, and `seguridad` was — the card knew how to
// show the findings, but they never reached it (box rehearsal of 2026-10-16).
// Client-safe: no server imports.

import type { Finding } from "./types";

export interface SecurityForCard {
  readonly fingerprint: string;
  readonly blocking: Finding[];
  readonly medium: Finding[];
}

const SOURCES = new Set(["rule", "model"]);
const SEVERITIES = new Set(["HIGH", "MEDIUM"]);

function isFinding(x: unknown): x is Finding {
  const f = x as Record<string, unknown> | null;
  if (!f || typeof f !== "object") return false;
  const params = f.params as Record<string, unknown> | null | undefined;
  return (
    typeof f.key === "string" &&
    SOURCES.has(f.source as string) &&
    SEVERITIES.has(f.severity as string) &&
    typeof f.category === "string" &&
    (f.file === null || typeof f.file === "string") &&
    (f.line === null || typeof f.line === "number") &&
    typeof f.description === "string" &&
    typeof f.exploitScenario === "string" &&
    typeof f.recommendation === "string" &&
    (params === undefined || (!!params && typeof params === "object" && Object.values(params).every((v) => typeof v === "string")))
  );
}

/** The review's findings as the card shows them, or `undefined` if `x` doesn't have that shape. */
export function securityForCard(x: unknown): SecurityForCard | undefined {
  const s = x as Record<string, unknown> | null;
  if (!s || typeof s !== "object" || typeof s.fingerprint !== "string") return undefined;
  if (!Array.isArray(s.blocking) || !Array.isArray(s.medium)) return undefined;
  if (!s.blocking.every(isFinding) || !s.medium.every(isFinding)) return undefined;
  return { fingerprint: s.fingerprint, blocking: s.blocking, medium: s.medium };
}
