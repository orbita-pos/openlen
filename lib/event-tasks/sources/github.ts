// THE `github` SOURCE (spec local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.4.5): the project's GitHub repository —
// the remote gh would pick — read with the owner's installation token, asked per repository and never stored or put in
// the box. What the Super-agent watches there: issues and pull requests (opened, closed, updated with their new
// comments) and failed CI checks, on the default branch and the most recently updated open pull requests. The App has
// no webhook, so it is polled every five minutes. The owner's own replies (comments by the OpenLen App) don't wake the
// task again. Its channel: a comment on the issue or pull request (../actions/channels/github.ts).
import "server-only";

import type { z } from "zod";

import { githubApi, githubMessage, type GitHubAnswer } from "@/lib/gh/rest";
import { githubAppLogin } from "@/lib/integrations/github-app";

import { githubParamsSchema } from "./declarations";
import { MATCHING_MAX, SourceError, type EventSource, type SourceChange } from "./types";

export interface GithubParams {
  readonly conditions?: readonly { readonly field: string; readonly op: "eq" | "neq" | "contains" | "gt" | "lt" | "exists"; readonly value?: string | number }[];
}

export interface GithubState {
  readonly owner: string;
  readonly repo: string;
  readonly defaultBranch: string;
  /** The last issue or pull request's `updated_at` taken, ISO. */
  readonly cursor: string;
  /** Checks completed before this are not news (the task's creation). */
  readonly ciCursor: string;
  /** The failed checks already told, newest last. */
  readonly ciSeen: readonly string[];
}

type RepoOf = (projectId: string, ownerId: string, token?: undefined, pinned?: { readonly owner: string; readonly repo: string }) => Promise<{ ok: true; owner: string; repo: string; token: string } | { ok: false; reason: "no_remote" | "not_connected" | "no_token" }>;

export interface GithubSourceDeps {
  repoOf: RepoOf;
  api: typeof githubApi;
  /** The OpenLen App's login on GitHub (`<slug>[bot]`), null when unknown. */
  appLogin(): string | null;
}

/** Issues and pull requests per check; the rest come on the next one. */
const MAX_ITEMS = 20;
const PAGE = 30;
const OPEN_PRS = 5;
const CI_SEEN = 200;
const BEFORE = 10;
const THREAD = 20;
const FAILED = new Set(["failure", "timed_out"]);

const WHY: Record<"no_remote" | "not_connected" | "no_token", string> = {
  no_remote: "This project has no GitHub repository: connect GitHub (Publish → Export → «Connect GitHub») and add it as a remote.",
  not_connected: "The OpenLen GitHub app isn't installed on the account that owns this project's GitHub repository.",
  no_token: "GitHub didn't give access to this project's repository.",
};

const paramsSchema = githubParamsSchema as unknown as z.ZodType<GithubParams>;

// GitHub's JSON, read field by field.
type Item = any;

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const labelsOf = (i: Item) => ((i.labels ?? []) as { name?: string }[]).map((l) => l.name ?? "").filter(Boolean).join(", ");
const kindOf = (i: Item) => (i.pull_request ? "pull_request" : "issue");
const commentOf = (c: Item) => ({ author: c.user?.login ?? "", body: c.body ?? "", at: c.created_at ?? "" });
/** An issue or pull request as the judge reads it; `number` and `title` make it answerable (../actions/seen.ts). */
const itemRow = (i: Item) => ({ number: i.number, kind: kindOf(i), title: i.title ?? "", state: i.state ?? "", author: i.user?.login ?? "", labels: labelsOf(i), url: i.html_url ?? "", updated_at: i.updated_at ?? "" });

export function githubSourceWith(deps: GithubSourceDeps): EventSource<GithubParams, GithubState> {
  /** The token for the repository the task was made for, whatever the remotes say now (final review I4). */
  async function connect(projectId: string, ownerId: string, state: GithubState) {
    const r = await deps.repoOf(projectId, ownerId, undefined, { owner: state.owner, repo: state.repo });
    if (!r.ok) throw new SourceError("github_unavailable", WHY[r.reason]);
    return r;
  }

  /** One request; a refusal the owner can understand is the source's failure (the watcher records it). */
  async function call(token: string, path: string): Promise<GitHubAnswer> {
    return checked(await deps.api("GET", path, token));
  }

  function checked(a: GitHubAnswer): GitHubAnswer {
    if (a.status >= 200 && a.status < 300) return a;
    if (a.status === 429 || (a.status === 403 && a.rateRemaining === 0)) throw new SourceError("rate_limited", `GitHub's rate limit is spent: ${githubMessage(a)}`);
    if (a.status === 401 || a.status === 403 || a.status === 404) throw new SourceError("github_unavailable", `GitHub answered ${a.status}: ${githubMessage(a)}`);
    throw new SourceError("read_failed", `GitHub answered ${a.status}: ${githubMessage(a)}`);
  }

  async function issues(token: string, base: string, state: GithubState, app: string | null): Promise<{ changes: SourceChange[]; cursor: string }> {
    const since = ms(state.cursor);
    const q = new URLSearchParams({ state: "all", sort: "updated", direction: "asc", since: state.cursor, per_page: String(PAGE) });
    const fresh = ((await call(token, `${base}/issues?${q}`)).body as Item[]).filter((i) => ms(i.updated_at) > since);
    let batch = fresh.slice(0, MAX_ITEMS);
    if (fresh.length > MAX_ITEMS) {
      // Never cut a run of items that share the cut's time: the next check starts after it.
      const cut = batch.at(-1)!.updated_at;
      const before = batch.filter((i) => i.updated_at !== cut);
      batch = before.length > 0 ? before : fresh.filter((i) => i.updated_at === cut);
    }
    const changes: SourceChange[] = [];
    for (const i of batch) {
      const action = ms(i.created_at) > since ? "opened" : i.closed_at && ms(i.closed_at) > since ? "closed" : "updated";
      let comments: Item[] = [];
      if (action === "updated") {
        comments = ((await call(token, `${base}/issues/${i.number}/comments?since=${encodeURIComponent(state.cursor)}&per_page=${PAGE}`)).body as Item[])
          // GitHub's `since` is inclusive: a comment at the cursor's own time was already told (final review I2).
          .filter((c) => ms(c.updated_at ?? c.created_at) > since);
        const ours = (c: Item) => app !== null && c.user?.type === "Bot" && c.user?.login === app;
        // The owner's own reply, posted by the App: not news.
        if (comments.length > 0 && comments.every(ours)) continue;
        comments = comments.filter((c) => !ours(c));
      }
      const kind = kindOf(i);
      changes.push({
        subject: kind,
        summary: `#${i.number} ${i.title ?? ""}`,
        detail: {
          kind,
          action,
          number: i.number,
          title: i.title ?? "",
          state: i.state ?? "",
          author: i.user?.login ?? "",
          labels: labelsOf(i),
          body: i.body ?? "",
          new_comments: comments.map(commentOf),
          url: i.html_url ?? "",
          created_at: i.created_at ?? "",
          updated_at: i.updated_at ?? "",
        },
        link: String(i.number),
        at: i.updated_at ?? "",
      });
    }
    return { changes, cursor: batch.at(-1)?.updated_at ?? state.cursor };
  }

  async function failedChecks(token: string, base: string, state: GithubState): Promise<{ changes: SourceChange[]; seen: string[]; defaultBranch: string }> {
    let defaultBranch = state.defaultBranch;
    let answer = await deps.api("GET", `${base}/branches/${encodeURIComponent(defaultBranch)}`, token);
    if (answer.status === 404) {
      // Renamed (master → main): the repository says what it is now (final review I4).
      defaultBranch = (await call(token, base)).body?.default_branch ?? defaultBranch;
      answer = await deps.api("GET", `${base}/branches/${encodeURIComponent(defaultBranch)}`, token);
    }
    const branch = checked(answer).body;
    const pulls = (await call(token, `${base}/pulls?state=open&sort=updated&direction=desc&per_page=${OPEN_PRS}`)).body as Item[];
    const heads = [
      { sha: branch?.commit?.sha as string | undefined, branch: defaultBranch, number: null as number | null, title: defaultBranch },
      ...pulls.map((p) => ({ sha: p.head?.sha as string | undefined, branch: (p.head?.ref as string) ?? "", number: p.number as number, title: (p.title as string) ?? "" })),
    ].filter((h) => h.sha);
    const seen = new Set(state.ciSeen);
    const after = ms(state.ciCursor);
    const changes: SourceChange[] = [];
    for (const head of heads) {
      const runs = ((await call(token, `${base}/commits/${head.sha}/check-runs?per_page=50`)).body?.check_runs ?? []) as Item[];
      for (const run of runs) {
        const id = String(run.id);
        if (!FAILED.has(run.conclusion) || !(ms(run.completed_at) > after) || seen.has(id)) continue;
        seen.add(id);
        changes.push({
          subject: "ci",
          summary: `${run.name} ${run.conclusion} on ${head.branch}`,
          detail: { kind: "ci", action: "failed", number: head.number, title: head.title, branch: head.branch, check: run.name ?? "", conclusion: run.conclusion, url: run.html_url ?? "", completed_at: run.completed_at },
          link: id,
          at: run.completed_at,
        });
      }
    }
    return { changes, seen: [...seen].slice(-CI_SEEN), defaultBranch };
  }

  return {
    kind: "github",
    paramsSchema,
    offers: { dataChange: false, replies: ["github"] },
    // No webhook: GitHub is asked every five minutes, about ten calls of the installation's 5000 an hour.
    checkEveryMs: 5 * 60_000,

    async validate(projectId, _params, ctx) {
      const r = await deps.repoOf(projectId, ctx.ownerId);
      if (!r.ok) return { ok: false, reason: WHY[r.reason] };
      const a = await deps.api("GET", `/repos/${r.owner}/${r.repo}`, r.token);
      if (a.status !== 200) return { ok: false, reason: `GitHub didn't give access to ${r.owner}/${r.repo}: ${githubMessage(a)}` };
      // What exists now never fires.
      const now = ctx.now.toISOString();
      return { ok: true, initialState: { owner: r.owner, repo: r.repo, defaultBranch: a.body?.default_branch ?? "main", cursor: now, ciCursor: now, ciSeen: [] } };
    },

    async observe(projectId, _params, state, ctx) {
      const r = await connect(projectId, ctx.ownerId, state);
      const base = `/repos/${state.owner}/${state.repo}`;
      const found = await issues(r.token, base, state, deps.appLogin());
      const ci = await failedChecks(r.token, base, state);
      return { state: { ...state, cursor: found.cursor, ciSeen: ci.seen, defaultBranch: ci.defaultBranch }, changes: [...found.changes, ...ci.changes] };
    },

    async read(projectId, _params, { keys, state, match, ctx }) {
      const field = match?.[0]?.field;
      const query = field === "label" ? "labels" : field === "author" ? "creator" : field === "state" ? "state" : null;
      if (match && (match.length > 1 || (match.length === 1 && !query))) throw new SourceError("column_missing", "github matches label, author or state, one at a time.");
      const r = await connect(projectId, ctx.ownerId, state);
      const base = `/repos/${state.owner}/${state.repo}`;
      const items = [];
      for (const key of keys) {
        const n = Number(String(key).replace(/^#/, ""));
        if (!Number.isInteger(n) || n <= 0) continue;
        const one = await deps.api("GET", `${base}/issues/${n}`, r.token);
        if (one.status !== 200) continue;
        const comments = ((await call(r.token, `${base}/issues/${n}/comments?per_page=100`)).body as Item[]).slice(-THREAD).map(commentOf);
        items.push({ ...itemRow(one.body), body: one.body.body ?? "", comments });
      }
      const previous = ((await call(r.token, `${base}/issues?state=all&sort=updated&direction=desc&per_page=${BEFORE}`)).body as Item[]).map(itemRow);
      if (!query || !match?.[0]) return { items, previous };
      const q = new URLSearchParams({ state: query === "state" ? match[0].value : "all", per_page: String(MATCHING_MAX) });
      if (query !== "state") q.set(query, match[0].value);
      const matching = ((await call(r.token, `${base}/issues?${q}`)).body as Item[]).map(itemRow);
      return { items, previous, matching };
    },
  };
}

export const githubSource = githubSourceWith({
  repoOf: async (projectId, ownerId, _token, pinned) => (await import("@/lib/integrations/github-app-store")).githubRepoOfProject(projectId, ownerId, undefined, pinned),
  api: githubApi,
  // Trimmed like the App's other settings: a slug with a stray newline would turn the loop guard off.
  appLogin: () => githubAppLogin(),
});
