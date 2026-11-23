// «Lanzar 50/50» from the A vs B dialog, through the security review the launch runs on variant B
// (lib/ab/lifecycle.ts → runSecurityGate). Like publishing (`throughSecurity` in publish-request.ts): a review still
// running is waited for and the launch is sent again by itself — three waits at most — so nobody has to press twice.
// What it can't do comes back as a CODE: the dialog says it in the person's language, never the server's English
// sentence (seen in production on 23/11: «Security review requires attention…» in the Spanish interface, for a review
// that was only still running).

import type { AbExperimentView } from "@/lib/ab/types";
import type { ReviewView } from "@/lib/security-review/types";

import { waitForSecurityReview } from "./security-review-request";

export type AbLaunchOutcome =
  | { readonly kind: "launched"; readonly experiment: AbExperimentView }
  | { readonly kind: "security_review_pending" }
  | { readonly kind: "security_findings" }
  | { readonly kind: "error"; readonly error: string };

type Send = (url: string, init: RequestInit) => Promise<Response>;

type Pending = { readonly kind: "pending"; readonly fingerprint: string };

async function postLaunch(url: string, body: Record<string, unknown>, send: Send): Promise<AbLaunchOutcome | Pending> {
  let res: Response;
  try {
    res = await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { kind: "error", error: "network" };
  }
  const data = (await res.json().catch(() => null)) as { experiment?: AbExperimentView; error?: unknown; fingerprint?: unknown } | null;
  if (res.ok && data?.experiment) return { kind: "launched", experiment: data.experiment };
  if (res.status === 428 && data?.error === "security_review_pending") return { kind: "pending", fingerprint: String(data.fingerprint ?? "") };
  if (res.status === 428 && data?.error === "security_findings") return { kind: "security_findings" };
  return { kind: "error", error: typeof data?.error === "string" ? data.error : `HTTP ${res.status}` };
}

export async function postAbLaunchAfterSecurity(
  projectId: string,
  experimentId: string,
  body: Record<string, unknown>,
  o: {
    readonly send?: Send;
    readonly wait?: (projectId: string, fingerprint: string) => Promise<ReviewView | null>;
    /** Called each time it starts waiting for the review, so the button can say so. */
    readonly onWaiting?: () => void;
  } = {},
): Promise<AbLaunchOutcome> {
  const send = o.send ?? ((u, i) => fetch(u, i));
  const wait = o.wait ?? waitForSecurityReview;
  const url = `/api/projects/${encodeURIComponent(projectId)}/ab/${encodeURIComponent(experimentId)}/launch`;
  let outcome = await postLaunch(url, body, send);
  for (let k = 0; k < 3 && outcome.kind === "pending"; k++) {
    o.onWaiting?.();
    await wait(projectId, outcome.fingerprint);
    outcome = await postLaunch(url, body, send);
  }
  return outcome.kind === "pending" ? { kind: "security_review_pending" } : outcome;
}
