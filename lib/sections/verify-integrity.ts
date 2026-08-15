import { createHash } from "node:crypto";

/** Cloudflare's Email Address Obfuscation rewrites HTML in flight: mailto
 * anchors become /cdn-cgi/l/email-protection links and a decoder script is
 * injected. The bytes then no longer hash to what we stored, and the section
 * fetch fails closed — with no hint that a CDN, not the data, is the cause. */
const CDN_TRANSFORM = /cdn-cgi\/l\/email-protection|email-decode\.min\.js|data-cfemail=/;

export type SectionIntegrityStatus = "ok" | "unreachable" | "cdn_transformed" | "corrupt";

export interface SectionIntegrityRow {
  readonly id: string;
  readonly type: string;
  readonly status: SectionIntegrityStatus;
  readonly expectedHash: string;
  readonly servedHash: string | null;
  readonly httpStatus: number | null;
}

export interface SectionIntegrityReport {
  readonly schemaVersion: "section-integrity/1.0";
  readonly checked: number;
  readonly ok: number;
  readonly cdnTransformed: number;
  readonly corrupt: number;
  readonly unreachable: number;
  readonly rows: readonly SectionIntegrityRow[];
}

export interface SectionIntegrityInput {
  readonly id: string;
  readonly type: string;
  readonly contentHash: string;
  readonly storageUrl: string;
}

export function sectionContentHash(html: string): string {
  return createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
}

async function inspect(
  section: SectionIntegrityInput,
  fetchImpl: typeof fetch,
): Promise<SectionIntegrityRow> {
  const base = { id: section.id, type: section.type, expectedHash: section.contentHash };
  let response: Response;
  try {
    response = await fetchImpl(section.storageUrl, { cache: "no-store" });
  } catch {
    return { ...base, status: "unreachable", servedHash: null, httpStatus: null };
  }
  if (!response.ok) return { ...base, status: "unreachable", servedHash: null, httpStatus: response.status };

  const body = await response.text();
  const servedHash = sectionContentHash(body);
  if (servedHash === section.contentHash) {
    return { ...base, status: "ok", servedHash, httpStatus: response.status };
  }
  return {
    ...base,
    // A transformed body is an infrastructure problem with a configuration
    // fix; a corrupt one means the stored object really is not ours.
    status: CDN_TRANSFORM.test(body) ? "cdn_transformed" : "corrupt",
    servedHash,
    httpStatus: response.status,
  };
}

/**
 * Read-only. Confirms every published section still serves the exact bytes its
 * row claims, which is the invariant the composition path fails closed on.
 */
export async function verifySectionIntegrity(
  sections: readonly SectionIntegrityInput[],
  deps: { readonly fetchImpl?: typeof fetch; readonly concurrency?: number } = {},
): Promise<SectionIntegrityReport> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const concurrency = Math.max(1, Math.min(deps.concurrency ?? 12, 32));
  const queue = [...sections];
  const rows: SectionIntegrityRow[] = [];

  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const section = queue.shift();
      if (!section) return;
      rows.push(await inspect(section, fetchImpl));
    }
  }));

  rows.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: "section-integrity/1.0",
    checked: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    cdnTransformed: rows.filter((row) => row.status === "cdn_transformed").length,
    corrupt: rows.filter((row) => row.status === "corrupt").length,
    unreachable: rows.filter((row) => row.status === "unreachable").length,
    rows,
  };
}
