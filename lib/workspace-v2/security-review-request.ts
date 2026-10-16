// Asking for the security review from the interface (the publish dialog and
// Len's publish card): start it, read it, wait for it
// (spec local 2026-10-15-security-review-design, 4.4).

import type { ReviewView } from "@/lib/security-review/types";

async function viewFrom(res: Response): Promise<ReviewView | null> {
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { view?: ReviewView | null } | null;
  return data?.view ?? null;
}

export async function startSecurityReview(projectId: string, locale: string): Promise<ReviewView | null> {
  return viewFrom(
    await fetch(`/api/projects/${projectId}/security-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    }),
  );
}

export async function fetchSecurityReview(projectId: string, fingerprint: string): Promise<ReviewView | null> {
  return viewFrom(await fetch(`/api/projects/${projectId}/security-review?fingerprint=${fingerprint}`, { cache: "no-store" }));
}

/** Polls until the review isn't running, or the time is up. Answers the last view seen. */
export async function waitForSecurityReview(
  projectId: string,
  fingerprint: string,
  o: { readonly intervalMs?: number; readonly timeoutMs?: number; readonly signal?: AbortSignal } = {},
): Promise<ReviewView | null> {
  const interval = o.intervalMs ?? 2_000;
  const until = Date.now() + (o.timeoutMs ?? 180_000);
  let last: ReviewView | null = null;
  while (!o.signal?.aborted && Date.now() < until) {
    last = (await fetchSecurityReview(projectId, fingerprint).catch(() => null)) ?? last;
    if (last && last.status !== "running") return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}
