// `gh`, answered by OpenLen (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9), as `supabase` and `stripe`
// are: the syntax Claude Code uses millions of times, run on the server with the owner's GitHub App installation, so
// no token ever reaches the box or Len. It prints what the GitHub CLI prints without a terminal (./texts.ts). Its
// repository is the one the project's remotes point to, found as gh finds it; its git is the project's own.
import type { GitRunResult } from "@/lib/git/command";
import { GITHUB_API, githubRepoOf, type GitHubInstallation } from "@/lib/integrations/github-app";

import * as T from "./texts";

export interface GhDeps {
  /** The owner's installations of the App. */
  installations(): Promise<GitHubInstallation[]>;
  /** An installation token, for one repository or (no `repo`) the whole installation. */
  token(installationId: number, repo?: string): Promise<string | null>;
  /** git over the project's repository and working tree, as the terminal runs it. */
  git(args: readonly string[]): Promise<GitRunResult>;
}

export interface GhResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

const ok = (stdout: string, stderr = ""): GhResult => ({ stdout, stderr, exitCode: 0 });
const fail = (stderr: string, exitCode = 1): GhResult => ({ stdout: "", stderr, exitCode });

/** A failure that ends the command with gh's words. */
class GhExit extends Error {
  constructor(readonly result: GhResult) {
    super(result.stderr);
  }
}
const exit = (stderr: string, exitCode = 1): never => {
  throw new GhExit(fail(stderr, exitCode));
};

// ── Flags ────────────────────────────────────────────────────────────────────

interface FlagSpec {
  readonly bool?: readonly string[];
  readonly value?: readonly string[];
  /** Short → long. */
  readonly short?: Readonly<Record<string, string>>;
}

interface Parsed {
  readonly flags: ReadonlyMap<string, string | true>;
  readonly positional: readonly string[];
}

function parse(args: readonly string[], spec: FlagSpec): Parsed {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("-") || a === "-") {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    let name = eq === -1 ? a : a.slice(0, eq);
    if (!name.startsWith("--")) name = spec.short?.[name] ?? name;
    if (spec.bool?.includes(name)) {
      flags.set(name, true);
      continue;
    }
    if (spec.value?.includes(name)) {
      const v = eq === -1 ? args[++i] : a.slice(eq + 1);
      if (v === undefined) exit(`flag needs an argument: ${a}\n`);
      flags.set(name, v!);
      continue;
    }
    exit(`unknown flag: ${a}\n`);
  }
  return { flags, positional };
}

const str = (p: Parsed, name: string) => {
  const v = p.flags.get(name);
  return typeof v === "string" ? v : undefined;
};

// ── GitHub's API ─────────────────────────────────────────────────────────────

interface Answer {
  readonly status: number;
  // GitHub's JSON, read field by field below.
  readonly body: any;
  readonly url: string;
}

async function api(method: string, path: string, token: string, body?: unknown, accept = "application/vnd.github+json"): Promise<Answer> {
  const url = `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "OpenLen", ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A raw body (a README).
  }
  return { status: res.status, body: parsed, url };
}

const message = (a: Answer) => (a.body && typeof a.body === "object" && typeof a.body.message === "string" ? a.body.message : `HTTP ${a.status}`);
const httpFail = (a: Answer): never => exit(T.httpError(a.status, message(a), a.url));

// ── The repository and its token ─────────────────────────────────────────────

interface Repo {
  readonly owner: string;
  readonly name: string;
  readonly token: string;
}

/** gh's base repository: the remotes, upstream first, then github, then origin, then the rest (remote_resolver.go). */
async function baseRepo(deps: GhDeps): Promise<Repo> {
  const listed = await deps.git(["remote", "-v"]);
  const urls = new Map<string, string>();
  for (const line of listed.stdout.split("\n")) {
    const m = /^(\S+)\t(\S+) \(fetch\)$/.exec(line);
    if (m) urls.set(m[1]!, m[2]!);
  }
  if (urls.size === 0) exit(T.NO_REMOTES);
  const rank = (n: string) => ["upstream", "github", "origin"].indexOf(n) === -1 ? 3 : ["upstream", "github", "origin"].indexOf(n);
  const repo = [...urls.entries()].sort((a, b) => rank(a[0]) - rank(b[0])).map(([, u]) => githubRepoOf(u)).find((r) => r !== null);
  if (!repo) exit(T.NO_GITHUB_REMOTE);
  return { owner: repo!.owner, name: repo!.repo, token: await repoToken(deps, repo!.owner, repo!.repo) };
}

const notResolved = (owner: string, name: string) => `GraphQL: Could not resolve to a Repository with the name '${owner}/${name}'. (repository)\n`;

async function repoToken(deps: GhDeps, owner: string, name: string): Promise<string> {
  const installations = await deps.installations();
  if (installations.length === 0) exit(T.AUTH_REQUIRED, T.EXIT_AUTH);
  const inst = installations.find((i) => i.accountLogin.toLowerCase() === owner.toLowerCase());
  const token = inst ? await deps.token(inst.installationId, name) : null;
  if (!token) exit(notResolved(owner, name));
  return token!;
}

async function getRepo(r: Repo): Promise<Answer> {
  const a = await api("GET", `/repos/${r.owner}/${r.name}`, r.token);
  if (a.status === 404) exit(notResolved(r.owner, r.name));
  if (a.status !== 200) httpFail(a);
  return a;
}

/** The current branch and its upstream's branch, from `git status -sb` ("## nueva...origin/nueva [ahead 1]"). */
async function currentBranch(deps: GhDeps): Promise<{ branch: string; upstream: string | null }> {
  const first = (await deps.git(["status", "-sb"])).stdout.split("\n")[0] ?? "";
  const m = /^## (.+?)(?:\.\.\.(\S+?))?(?: \[.*\])?$/.exec(first);
  const upstream = m?.[2] ? m[2].slice(m[2].indexOf("/") + 1) : null;
  return { branch: m?.[1] ?? "", upstream };
}

// ── --json ───────────────────────────────────────────────────────────────────

type Fields = Readonly<Record<string, (o: Answer["body"]) => unknown>>;

function asJson(fields: Fields, list: string, items: readonly unknown[] | unknown): string {
  const wanted = list.split(",").map((f) => f.trim()).filter(Boolean);
  for (const f of wanted) {
    if (!Object.hasOwn(fields, f)) exit(`Unknown JSON field: "${f}"\nAvailable fields:\n${Object.keys(fields).sort().map((k) => `  ${k}\n`).join("")}`);
  }
  // gh writes a map: Go sorts its keys.
  const pick = (o: unknown) => Object.fromEntries([...wanted].sort().map((f) => [f, fields[f]!(o)]));
  return `${JSON.stringify(Array.isArray(items) ? items.map(pick) : pick(items))}\n`;
}

const REPO_FIELDS: Fields = {
  name: (r) => r.name,
  nameWithOwner: (r) => r.full_name,
  url: (r) => r.html_url,
  description: (r) => r.description ?? "",
  isPrivate: (r) => Boolean(r.private),
  visibility: (r) => String(r.visibility ?? (r.private ? "private" : "public")).toUpperCase(),
  defaultBranchRef: (r) => ({ name: r.default_branch }),
  homepageUrl: (r) => r.homepage ?? "",
};

const prState = (p: Answer["body"]) => (p.merged_at ? "MERGED" : p.state === "closed" ? "CLOSED" : "OPEN");
const PR_FIELDS: Fields = {
  number: (p) => p.number,
  title: (p) => p.title,
  state: prState,
  url: (p) => p.html_url,
  headRefName: (p) => p.head?.ref,
  baseRefName: (p) => p.base?.ref,
  author: (p) => ({ login: p.user?.login }),
  body: (p) => p.body ?? "",
  isDraft: (p) => Boolean(p.draft),
  createdAt: (p) => p.created_at,
  mergedAt: (p) => p.merged_at ?? null,
  additions: (p) => p.additions,
  deletions: (p) => p.deletions,
};

const ISSUE_FIELDS: Fields = {
  number: (i) => i.number,
  title: (i) => i.title,
  state: (i) => String(i.state).toUpperCase(),
  url: (i) => i.html_url,
  author: (i) => ({ login: i.user?.login }),
  body: (i) => i.body ?? "",
  labels: (i) => (i.labels ?? []).map((l: { name: string }) => ({ name: l.name })),
  createdAt: (i) => i.created_at,
  updatedAt: (i) => i.updated_at,
};

const logins = (xs: { login: string }[] | undefined) => (xs ?? []).map((x) => x.login).join(", ");

// ── Commands ─────────────────────────────────────────────────────────────────

async function authStatus(deps: GhDeps): Promise<GhResult> {
  const installations = await deps.installations();
  if (installations.length === 0) return fail(T.NOT_LOGGED_IN);
  const lines = installations.map((i, n) => `  ✓ Logged in to github.com account ${i.accountLogin} (GitHub App)\n  - Active account: ${n === 0}\n  - Git operations protocol: https\n`);
  return ok(`github.com\n${lines.join("\n")}`);
}

async function repoCreate(args: readonly string[], ctx: { canEdit: boolean }, deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { bool: ["--private", "--public", "--internal", "--push"], value: ["--description", "--source", "--remote", "--homepage"], short: { "-d": "--description", "-s": "--source", "-r": "--remote", "-h": "--homepage" } });
  if (!p.flags.has("--private") && !p.flags.has("--public") && !p.flags.has("--internal")) return fail(T.VISIBILITY_REQUIRED);
  if (p.flags.has("--push") && !p.flags.has("--source")) return fail(T.PUSH_NEEDS_SOURCE);
  const full = p.positional[0];
  if (!full) return fail(T.NAME_REQUIRED);
  if (!ctx.canEdit) return fail(T.PERMISSION_DENIED);
  const installations = await deps.installations();
  if (installations.length === 0) return fail(T.AUTH_REQUIRED, T.EXIT_AUTH);
  const [owner, name] = full.includes("/") ? (full.split("/", 2) as [string, string]) : [null, full];
  const inst = owner ? installations.find((i) => i.accountLogin.toLowerCase() === owner.toLowerCase()) : (installations.find((i) => i.accountType === "User") ?? installations[0]);
  if (!inst) return fail(`GraphQL: ${owner} is not an account the project's owner connected (createRepository)\n`);
  const token = await deps.token(inst.installationId);
  if (!token) return fail(T.AUTH_REQUIRED, T.EXIT_AUTH);
  const visibility = p.flags.has("--internal") ? "internal" : p.flags.has("--private") ? "private" : "public";
  const created = await api("POST", inst.accountType === "Organization" ? `/orgs/${inst.accountLogin}/repos` : "/user/repos", token, {
    name,
    private: visibility !== "public",
    ...(visibility === "internal" ? { visibility } : {}),
    ...(str(p, "--description") ? { description: str(p, "--description") } : {}),
    ...(str(p, "--homepage") ? { homepage: str(p, "--homepage") } : {}),
  });
  if (created.status === 422 && JSON.stringify(created.body).includes("already exists")) return fail(T.NAME_EXISTS);
  if (created.status !== 201) httpFail(created);
  let stdout = `${created.body.html_url}\n`;
  let stderr = "";
  if (p.flags.has("--source")) {
    const remote = str(p, "--remote") ?? "origin";
    const added = await deps.git(["remote", "add", remote, created.body.clone_url]);
    if (added.exitCode !== 0) return { stdout, stderr: added.stderr, exitCode: 1 };
    if (p.flags.has("--push")) {
      // gh's git client: git push --set-upstream <remote> HEAD, its output passed through.
      const pushed = await deps.git(["push", "--set-upstream", remote, "HEAD"]);
      stdout += pushed.stdout;
      stderr += pushed.stderr;
      if (pushed.exitCode !== 0) return { stdout, stderr, exitCode: 1 };
    }
  }
  return ok(stdout, stderr);
}

async function repoView(args: readonly string[], deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { value: ["--json"], bool: ["--web"], short: { "-w": "--web" } });
  if (p.flags.has("--web")) return fail(T.notHere("repo view --web", "Open the repository's URL from gh repo view --json url."));
  const repo = await getRepo(await baseRepo(deps));
  const json = str(p, "--json");
  if (json) return ok(asJson(REPO_FIELDS, json, repo.body));
  const r = repo.body;
  const readme = await api("GET", `/repos/${r.full_name}/readme`, (await baseRepo(deps)).token, undefined, "application/vnd.github.raw");
  const text = readme.status === 200 && typeof readme.body === "string" ? `${readme.body.replace(/\n?$/, "\n")}` : "";
  return ok(`name:\t${r.full_name}\ndescription:\t${r.description ?? ""}\n--\n${text}`);
}

async function prCreate(args: readonly string[], ctx: { canEdit: boolean }, deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { value: ["--title", "--body", "--base", "--head"], bool: ["--draft"], short: { "-t": "--title", "-b": "--body", "-B": "--base", "-H": "--head", "-d": "--draft" } });
  const title = str(p, "--title");
  const body = str(p, "--body");
  if (title === undefined || body === undefined) return fail(T.TITLE_BODY_REQUIRED);
  if (!ctx.canEdit) return fail(T.PERMISSION_DENIED);
  const repo = await baseRepo(deps);
  let head = str(p, "--head");
  if (!head) {
    const { upstream } = await currentBranch(deps);
    if (!upstream) return fail(T.MUST_PUSH);
    head = upstream;
  }
  const changes = (await deps.git(["status", "--porcelain"])).stdout.split("\n").filter(Boolean).length;
  const warning = changes > 0 ? T.uncommitted(changes) : "";
  const base = str(p, "--base") ?? (await getRepo(repo)).body.default_branch;
  const made = await api("POST", `/repos/${repo.owner}/${repo.name}/pulls`, repo.token, { title, body, head, base, draft: p.flags.has("--draft") });
  if (made.status === 422 && JSON.stringify(made.body).includes("already exists")) {
    const open = await api("GET", `/repos/${repo.owner}/${repo.name}/pulls?head=${encodeURIComponent(`${repo.owner}:${head}`)}&base=${encodeURIComponent(base)}&state=open`, repo.token);
    return fail(`${warning}${T.prExists(head, base, open.body?.[0]?.html_url ?? "")}`);
  }
  if (made.status !== 201) httpFail(made);
  return ok(`${made.body.html_url}\n`, warning);
}

/** The pull request a command names, or the current branch's. */
async function findPr(repo: Repo, deps: GhDeps, arg: string | undefined): Promise<Answer["body"]> {
  if (arg) {
    const n = Number(String(arg).replace(/^#/, "").replace(/^.*\/pull\//, ""));
    const a = await api("GET", `/repos/${repo.owner}/${repo.name}/pulls/${n}`, repo.token);
    if (a.status === 404) exit(`GraphQL: Could not resolve to a PullRequest with the number of ${n}. (repository.pullRequest)\n`);
    if (a.status !== 200) httpFail(a);
    return a.body;
  }
  const { branch, upstream } = await currentBranch(deps);
  const head = upstream ?? branch;
  const list = await api("GET", `/repos/${repo.owner}/${repo.name}/pulls?head=${encodeURIComponent(`${repo.owner}:${head}`)}&state=open`, repo.token);
  if (list.status !== 200) httpFail(list);
  if (!Array.isArray(list.body) || list.body.length === 0) exit(T.noPrForBranch(branch));
  return list.body[0];
}

async function prList(args: readonly string[], deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { value: ["--state", "--limit", "--json", "--base", "--head"], short: { "-s": "--state", "-L": "--limit", "-B": "--base", "-H": "--head" } });
  const repo = await baseRepo(deps);
  const state = str(p, "--state") ?? "open";
  const limit = Number(str(p, "--limit") ?? 30);
  const q = new URLSearchParams({ state: state === "merged" ? "closed" : state, per_page: String(Math.min(100, limit)) });
  if (str(p, "--base")) q.set("base", str(p, "--base")!);
  if (str(p, "--head")) q.set("head", `${repo.owner}:${str(p, "--head")}`);
  const a = await api("GET", `/repos/${repo.owner}/${repo.name}/pulls?${q}`, repo.token);
  if (a.status !== 200) httpFail(a);
  const prs = (a.body as Answer["body"][]).filter((pr) => state !== "merged" || pr.merged_at).slice(0, limit);
  const json = str(p, "--json");
  if (json) return ok(asJson(PR_FIELDS, json, prs));
  return ok(prs.map((pr) => `${pr.number}\t${pr.title}\t${pr.head?.ref}\t${pr.draft ? "DRAFT" : prState(pr)}\t${pr.created_at}\n`).join(""));
}

async function prView(args: readonly string[], deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { value: ["--json"], bool: ["--web", "--comments"], short: { "-w": "--web", "-c": "--comments" } });
  if (p.flags.has("--web")) return fail(T.notHere("pr view --web", "Use gh pr view --json url."));
  const repo = await baseRepo(deps);
  const pr = await findPr(repo, deps, p.positional[0]);
  const json = str(p, "--json");
  if (json) return ok(asJson(PR_FIELDS, json, pr));
  const reviewers = (pr.requested_reviewers ?? []).map((r: { login: string }) => `${r.login} (Requested)`).join(", ");
  return ok(
    `title:\t${pr.title}\nstate:\t${pr.draft ? "DRAFT" : prState(pr)}\nauthor:\t${pr.user?.login ?? ""}\nlabels:\t${(pr.labels ?? []).map((l: { name: string }) => l.name).join(", ")}\n` +
      `assignees:\t${logins(pr.assignees)}\nreviewers:\t${reviewers}\nprojects:\t\nmilestone:\t${pr.milestone?.title ?? ""}\nnumber:\t${pr.number}\nurl:\t${pr.html_url}\n` +
      `additions:\t${pr.additions ?? 0}\ndeletions:\t${pr.deletions ?? 0}\nauto-merge:\tdisabled\n--\n${pr.body ?? ""}\n`,
  );
}

/** Go's time.Duration, rounded to the second: 1m2s, 45s, 1h0m3s. */
function elapsed(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return "0";
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}h${m}m${sec}s` : m > 0 ? `${m}m${sec}s` : `${sec}s`;
}

async function prChecks(args: readonly string[], deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { bool: ["--watch", "--required", "--fail-fast"] });
  if (p.flags.has("--watch")) return fail(T.notHere("pr checks --watch", "Run gh pr checks again to see where they stand."));
  const repo = await baseRepo(deps);
  const pr = await findPr(repo, deps, p.positional[0]);
  const sha = pr.head?.sha;
  const [runs, statuses] = await Promise.all([
    api("GET", `/repos/${repo.owner}/${repo.name}/commits/${sha}/check-runs`, repo.token),
    api("GET", `/repos/${repo.owner}/${repo.name}/commits/${sha}/status`, repo.token),
  ]);
  const lines: { name: string; state: string; time: string; url: string }[] = [];
  for (const r of runs.body?.check_runs ?? []) {
    const state =
      r.status !== "completed" ? "pending" : r.conclusion === "success" ? "pass" : ["skipped", "neutral"].includes(r.conclusion) ? "skipping" : "fail";
    lines.push({ name: r.name, state, time: state === "pending" ? "0" : elapsed(r.started_at, r.completed_at), url: r.html_url ?? "" });
  }
  for (const s of statuses.body?.statuses ?? []) {
    lines.push({ name: s.context, state: s.state === "success" ? "pass" : s.state === "pending" ? "pending" : "fail", time: "0", url: s.target_url ?? "" });
  }
  if (lines.length === 0) return fail(`no checks reported on the '${pr.head?.ref}' branch\n`);
  const stdout = lines.map((l) => `${l.name}\t${l.state}\t${l.time}\t${l.url}\n`).join("");
  const code = lines.some((l) => l.state === "fail") ? 1 : lines.some((l) => l.state === "pending") ? 8 : 0;
  return { stdout, stderr: "", exitCode: code };
}

async function prMerge(args: readonly string[], ctx: { canEdit: boolean }, deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { bool: ["--merge", "--squash", "--rebase", "--delete-branch", "--auto"], value: ["--subject", "--body"], short: { "-m": "--merge", "-s": "--squash", "-r": "--rebase", "-d": "--delete-branch", "-t": "--subject", "-b": "--body" } });
  const method = p.flags.has("--merge") ? "merge" : p.flags.has("--squash") ? "squash" : p.flags.has("--rebase") ? "rebase" : null;
  if (!method) return fail(T.MERGE_METHOD_REQUIRED);
  if (p.flags.has("--auto")) return fail(T.notHere("pr merge --auto", "Merge it once its checks pass."));
  if (!ctx.canEdit) return fail(T.PERMISSION_DENIED);
  const repo = await baseRepo(deps);
  const pr = await findPr(repo, deps, p.positional[0]);
  const merged = await api("PUT", `/repos/${repo.owner}/${repo.name}/pulls/${pr.number}/merge`, repo.token, {
    merge_method: method,
    ...(str(p, "--subject") ? { commit_title: str(p, "--subject") } : {}),
    ...(str(p, "--body") ? { commit_message: str(p, "--body") } : {}),
  });
  if (merged.status === 405 || merged.status === 409) return fail(`Pull request #${pr.number} is not mergeable: ${message(merged)}\n`);
  if (merged.status !== 200) httpFail(merged);
  if (p.flags.has("--delete-branch") && pr.head?.ref) {
    const del = await api("DELETE", `/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeURIComponent(pr.head.ref)}`, repo.token);
    if (del.status !== 204 && del.status !== 422) httpFail(del);
  }
  return ok("");
}

async function issueList(args: readonly string[], deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { value: ["--state", "--limit", "--json", "--label"], short: { "-s": "--state", "-L": "--limit", "-l": "--label" } });
  const repo = await baseRepo(deps);
  const limit = Number(str(p, "--limit") ?? 30);
  const q = new URLSearchParams({ state: str(p, "--state") ?? "open", per_page: String(Math.min(100, limit)) });
  if (str(p, "--label")) q.set("labels", str(p, "--label")!);
  const a = await api("GET", `/repos/${repo.owner}/${repo.name}/issues?${q}`, repo.token);
  if (a.status !== 200) httpFail(a);
  // The issues API also lists pull requests; gh's issue list doesn't.
  const issues = (a.body as Answer["body"][]).filter((i) => !i.pull_request).slice(0, limit);
  const json = str(p, "--json");
  if (json) return ok(asJson(ISSUE_FIELDS, json, issues));
  return ok(issues.map((i) => `${i.number}\t${String(i.state).toUpperCase()}\t${i.title}\t${(i.labels ?? []).map((l: { name: string }) => l.name).join(", ")}\t${i.updated_at}\n`).join(""));
}

async function issueView(args: readonly string[], deps: GhDeps): Promise<GhResult> {
  const p = parse(args, { value: ["--json"], bool: ["--web", "--comments"], short: { "-w": "--web", "-c": "--comments" } });
  const n = Number(String(p.positional[0] ?? "").replace(/^#/, "").replace(/^.*\/issues\//, ""));
  if (!n) return fail("argument required: issue number or URL\n");
  const repo = await baseRepo(deps);
  const a = await api("GET", `/repos/${repo.owner}/${repo.name}/issues/${n}`, repo.token);
  if (a.status === 404) return fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${n}. (repository.issue)\n`);
  if (a.status !== 200) httpFail(a);
  const i = a.body;
  const json = str(p, "--json");
  if (json) return ok(asJson(ISSUE_FIELDS, json, i));
  return ok(
    `title:\t${i.title}\nstate:\t${String(i.state).toUpperCase()}\nauthor:\t${i.user?.login ?? ""}\nlabels:\t${(i.labels ?? []).map((l: { name: string }) => l.name).join(", ")}\n` +
      `comments:\t${i.comments ?? 0}\nassignees:\t${logins(i.assignees)}\nprojects:\t\nmilestone:\t${i.milestone?.title ?? ""}\nnumber:\t${i.number}\n--\n${i.body ?? ""}\n`,
  );
}

/** Known to gh, not here. */
const ELSEWHERE: Readonly<Record<string, string>> = {
  api: "Use gh repo, gh pr or gh issue.",
  browse: "Use gh repo view --json url.",
  run: "Use gh pr checks to see a pull request's checks.",
  workflow: "Use gh pr checks to see a pull request's checks.",
  release: "Releases aren't available yet.",
  gist: "Gists aren't available.",
  codespace: "Codespaces aren't available.",
  secret: "The project's secrets live in OpenLen, not in GitHub.",
  ssh: "OpenLen's git uses https.",
  "ssh-key": "OpenLen's git uses https.",
  extension: "Extensions aren't available.",
  alias: "Aliases aren't available.",
  config: "OpenLen's gh has no configuration.",
  label: "Labels aren't available yet.",
  search: "Search isn't available yet.",
  project: "Projects aren't available.",
};

export async function runGh(argv: readonly string[], ctx: { readonly canEdit: boolean }, deps: GhDeps): Promise<GhResult> {
  const [cmd, sub, ...rest] = argv;
  try {
    if (cmd === undefined || cmd === "--help" || cmd === "-h" || cmd === "help") return ok(T.HELP);
    if (cmd === "auth") {
      if (sub === "status") return await authStatus(deps);
      return fail(T.notHere(`auth ${sub ?? ""}`.trim(), `The project's owner connects GitHub in OpenLen: ${T.CONNECT}.`));
    }
    if (cmd === "repo") {
      if (sub === "create") return await repoCreate(rest, ctx, deps);
      if (sub === "view") return await repoView(rest, deps);
      return fail(T.notHere(`repo ${sub ?? ""}`.trim(), "Use gh repo create or gh repo view."));
    }
    if (cmd === "pr") {
      if (sub === "create") return await prCreate(rest, ctx, deps);
      if (sub === "list") return await prList(rest, deps);
      if (sub === "view") return await prView(rest, deps);
      if (sub === "checks") return await prChecks(rest, deps);
      if (sub === "merge") return await prMerge(rest, ctx, deps);
      return fail(T.notHere(`pr ${sub ?? ""}`.trim(), "Use gh pr create, list, view, checks or merge."));
    }
    if (cmd === "issue") {
      if (sub === "list") return await issueList(rest, deps);
      if (sub === "view") return await issueView(rest, deps);
      return fail(T.notHere(`issue ${sub ?? ""}`.trim(), "Use gh issue list or gh issue view."));
    }
    if (Object.hasOwn(ELSEWHERE, cmd)) return fail(T.notHere(cmd, ELSEWHERE[cmd]!));
    return fail(T.unknownCommand(cmd));
  } catch (e) {
    if (e instanceof GhExit) return e.result;
    throw e;
  }
}
