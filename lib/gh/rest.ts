// GitHub's REST API as OpenLen calls it (lib/gh/run.ts for `gh`, lib/event-tasks for the `github` source and its
// comment channel): one request with an installation token, GitHub's JSON back, and how much of the rate limit is left.
// It never throws on an HTTP error: the caller reads the status.
import { GITHUB_API } from "@/lib/integrations/github-app";

export interface GitHubAnswer {
  readonly status: number;
  // GitHub's JSON, read field by field by each caller.
  readonly body: any;
  readonly url: string;
  /** `x-ratelimit-remaining`, null when GitHub didn't say. */
  readonly rateRemaining: number | null;
  /** `retry-after` in seconds (a secondary rate limit), null when absent. */
  readonly retryAfter: number | null;
}

/** A GitHub request that takes longer gives up: a hung one held the event tasks' whole pass (final review). */
export const GITHUB_TIMEOUT_MS = 30_000;

export async function githubApi(method: string, path: string, token: string, body?: unknown, accept = "application/vnd.github+json"): Promise<GitHubAnswer> {
  const url = `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "OpenLen", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A raw body (a README).
  }
  const num = (h: string | null) => (h === null || h.trim() === "" || !Number.isFinite(Number(h)) ? null : Number(h));
  return { status: res.status, body: parsed, url, rateRemaining: num(res.headers.get("x-ratelimit-remaining")), retryAfter: num(res.headers.get("retry-after")) };
}

/** GitHub's own message of an answer, else its status. */
export const githubMessage = (a: GitHubAnswer): string => (a.body && typeof a.body === "object" && typeof a.body.message === "string" ? a.body.message : `HTTP ${a.status}`);
