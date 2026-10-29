// @vitest-environment node
// `gh` answered by OpenLen (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §9): what the GitHub CLI prints
// without a terminal, with the owner's GitHub App installation. GitHub's API is a fake fetch; git is ours, against a
// real `git http-backend` where a push has to land.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRunResult } from "@/lib/git/command";
import { GitHttpServer } from "@/lib/git/test-support/http-backend";
import { OurRepo } from "@/lib/git/test-support/our-git";

import { runGh, type GhDeps } from "./run";
import * as T from "./texts";

type Handler = (body: unknown, url: URL) => { status: number; body?: unknown };
let routes: Record<string, Handler>;
let calls: { method: string; path: string; auth: string | null; body: unknown }[];

const json = (status: number, body?: unknown) => ({ status, body });
beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? null;
    calls.push({ method, path: `${url.pathname}${url.search}`, auth, body });
    const h = routes[`${method} ${url.pathname}`];
    const r = h ? h(body, url) : { status: 404, body: { message: "Not Found" } };
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const ANA = { installationId: 77, accountLogin: "ana", accountType: "User" as const };
const ACME = { installationId: 88, accountLogin: "acme", accountType: "Organization" as const };

/** git as a stub: what a project with origin on github.com/ana/web, on branch `nueva`, would say. */
function stubGit(o: { status?: string; porcelain?: string; remotes?: string } = {}): GhDeps["git"] {
  return async (args) => {
    const key = args.join(" ");
    const out = (stdout: string): GitRunResult => ({ stdout, stderr: "", exitCode: 0 });
    if (key === "remote -v") return out(o.remotes ?? "origin\thttps://github.com/ana/web.git (fetch)\norigin\thttps://github.com/ana/web.git (push)\n");
    if (key === "status -sb") return out(o.status ?? "## nueva...origin/nueva\n");
    if (key === "status --porcelain") return out(o.porcelain ?? "");
    throw new Error(`unexpected git ${key}`);
  };
}

function deps(over: Partial<GhDeps> = {}): GhDeps {
  return {
    installations: async () => [ANA],
    token: async (id, repo) => `ghs_${id}${repo ? `_${repo}` : ""}`,
    git: stubGit(),
    ...over,
  };
}
const gh = (argv: string, d: GhDeps = deps(), canEdit = true) => runGh(argv.split(" ").filter(Boolean), { canEdit }, d);

describe("gh auth", () => {
  it("🔴 status: the connected account, or how to connect it (exit 1)", async () => {
    expect(await gh("auth status", deps({ installations: async () => [] }))).toEqual({ stdout: "", stderr: T.NOT_LOGGED_IN, exitCode: 1 });
    expect(await gh("auth status")).toEqual({
      stdout: "github.com\n  ✓ Logged in to github.com account ana (GitHub App)\n  - Active account: true\n  - Git operations protocol: https\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("login and token are the owner's, in OpenLen", async () => {
    const r = await gh("auth login");
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain(T.CONNECT);
  });
});

describe("gh, what isn't here", () => {
  it("an unknown command is cobra's; api and others say they aren't here", async () => {
    expect(await gh("frobnicate")).toEqual({ stdout: "", stderr: T.unknownCommand("frobnicate"), exitCode: 1 });
    const api = await gh("api /user");
    expect(api.exitCode).toBe(1);
    expect(api.stderr).toMatch(/^gh api: not available here/);
    expect((await gh("")).stdout).toBe(T.HELP);
    expect((await gh("--help")).stdout).toBe(T.HELP);
  });
});

describe("gh repo create", () => {
  beforeEach(() => {
    routes["POST /user/repos"] = (b) => json(201, { full_name: `ana/${(b as { name: string }).name}`, html_url: `https://github.com/ana/${(b as { name: string }).name}`, clone_url: `https://github.com/ana/${(b as { name: string }).name}.git` });
    routes["POST /orgs/acme/repos"] = (b) => json(201, { full_name: `acme/${(b as { name: string }).name}`, html_url: `https://github.com/acme/${(b as { name: string }).name}`, clone_url: "x" });
  });

  it("🔴 creates it in the installation's account with the whole installation's token; prints the URL", async () => {
    expect(await gh("repo create web --private --description Mi-web")).toEqual({ stdout: "https://github.com/ana/web\n", stderr: "", exitCode: 0 });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/user/repos", auth: "Bearer ghs_77", body: { name: "web", private: true, description: "Mi-web" } });
    // owner/name: that owner's installation, an organization's endpoint.
    expect((await gh("repo create acme/tienda --public", deps({ installations: async () => [ANA, ACME] }))).stdout).toBe("https://github.com/acme/tienda\n");
    expect(calls[1]).toMatchObject({ path: "/orgs/acme/repos", auth: "Bearer ghs_88", body: { name: "tienda", private: false } });
  });

  it("gh's refusals: no visibility, --push without --source, no name, a name that exists", async () => {
    expect(await gh("repo create web")).toEqual({ stdout: "", stderr: T.VISIBILITY_REQUIRED, exitCode: 1 });
    expect(await gh("repo create web --private --push")).toEqual({ stdout: "", stderr: T.PUSH_NEEDS_SOURCE, exitCode: 1 });
    expect(await gh("repo create --private")).toEqual({ stdout: "", stderr: T.NAME_REQUIRED, exitCode: 1 });
    routes["POST /user/repos"] = () => json(422, { message: "Repository creation failed.", errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" }] });
    expect(await gh("repo create web --private")).toEqual({ stdout: "", stderr: T.NAME_EXISTS, exitCode: 1 });
    expect(calls.length).toBe(1);
  });

  it("🔴 a viewer can't; without GitHub connected, gh's auth exit 4", async () => {
    expect(await gh("repo create web --private", deps(), false)).toEqual({ stdout: "", stderr: T.PERMISSION_DENIED, exitCode: 1 });
    expect(await gh("repo create web --private", deps({ installations: async () => [] }))).toEqual({ stdout: "", stderr: T.AUTH_REQUIRED, exitCode: T.EXIT_AUTH });
    expect(calls).toHaveLength(0);
  });

  it("🔴 --source=. --remote=origin --push: adds origin and pushes HEAD, like gh (git's own output passes through)", async () => {
    const server = new GitHttpServer();
    await server.start();
    server.bare("web");
    const ours = new OurRepo();
    try {
      ours.write({ "index.html": "<h1>Hola</h1>\n" });
      // The first git command records the project as it is: the "Initial commit".
      expect((await ours.git(["log", "--oneline"])).stdout).toMatch(/Initial commit/);
      routes["POST /user/repos"] = () => json(201, { full_name: "ana/web", html_url: "https://github.com/ana/web", clone_url: server.url("web") });
      const r = await runGh(["repo", "create", "web", "--private", "--source=.", "--remote=origin", "--push"], { canEdit: true }, deps({ git: (a) => ours.git(a) }));
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toBe(`https://github.com/ana/web\nbranch 'main' set up to track 'origin/main'.\n`);
      expect(r.stderr).toBe(`To ${server.url("web")}\n * [new branch]      HEAD -> main\n`);
      expect((await ours.git(["remote", "get-url", "origin"])).stdout).toBe(`${server.url("web")}\n`);
      expect(server.git(["rev-parse", "main"], `${server.root}/web.git`).stdout).toBe((await ours.git(["rev-parse", "HEAD"])).stdout);
      expect((await ours.git(["status", "-sb"])).stdout).toBe("## main...origin/main\n");
    } finally {
      await server.dispose();
    }
  }, 30_000);
});

describe("gh repo view", () => {
  beforeEach(() => {
    routes["GET /repos/ana/web"] = () => json(200, { name: "web", full_name: "ana/web", html_url: "https://github.com/ana/web", description: "Mi web", private: true, visibility: "private", default_branch: "main" });
    routes["GET /repos/ana/web/readme"] = () => json(404, { message: "Not Found" });
  });

  it("🔴 the repository of origin, with that repository's token", async () => {
    expect((await gh("repo view")).stdout).toBe("name:\tana/web\ndescription:\tMi web\n--\n");
    expect(calls[0]!.auth).toBe("Bearer ghs_77_web");
    expect((await gh("repo view --json name,nameWithOwner,url,isPrivate,defaultBranchRef")).stdout).toBe(
      '{"defaultBranchRef":{"name":"main"},"isPrivate":true,"name":"web","nameWithOwner":"ana/web","url":"https://github.com/ana/web"}\n',
    );
    const bad = await gh("repo view --json nope");
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toMatch(/^Unknown JSON field: "nope"\nAvailable fields:\n/);
  });

  it("no remotes, or none on github.com: gh's errors", async () => {
    expect(await gh("repo view", deps({ git: stubGit({ remotes: "" }) }))).toEqual({ stdout: "", stderr: T.NO_REMOTES, exitCode: 1 });
    expect(await gh("repo view", deps({ git: stubGit({ remotes: "origin\thttps://gitlab.com/a/b.git (fetch)\norigin\thttps://gitlab.com/a/b.git (push)\n" }) }))).toEqual({ stdout: "", stderr: T.NO_GITHUB_REMOTE, exitCode: 1 });
  });
});

describe("gh pr", () => {
  beforeEach(() => {
    routes["GET /repos/ana/web"] = () => json(200, { name: "web", full_name: "ana/web", html_url: "https://github.com/ana/web", default_branch: "main", private: true });
  });

  it("🔴 create: the pushed branch into the default one; prints its URL", async () => {
    routes["POST /repos/ana/web/pulls"] = () => json(201, { number: 3, html_url: "https://github.com/ana/web/pull/3" });
    expect(await gh("pr create --title Arreglo --body Cuerpo")).toEqual({ stdout: "https://github.com/ana/web/pull/3\n", stderr: "", exitCode: 0 });
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ auth: "Bearer ghs_77_web", body: { title: "Arreglo", body: "Cuerpo", head: "nueva", base: "main", draft: false } });
    // --base and --draft; uncommitted changes warn, as gh does.
    const r = await gh("pr create --title T --body B --base dev --draft", deps({ git: stubGit({ porcelain: " M a.txt\n?? b.txt\n" }) }));
    expect(r.stderr).toBe(T.uncommitted(2));
    expect(calls.filter((c) => c.method === "POST")[1]).toMatchObject({ body: { base: "dev", draft: true } });
  });

  it("🔴 create: a branch not pushed, no title, one already open — gh's words", async () => {
    expect(await gh("pr create --title T --body B", deps({ git: stubGit({ status: "## nueva\n" }) }))).toEqual({ stdout: "", stderr: T.MUST_PUSH, exitCode: 1 });
    expect(await gh("pr create --body B")).toEqual({ stdout: "", stderr: T.TITLE_BODY_REQUIRED, exitCode: 1 });
    routes["POST /repos/ana/web/pulls"] = () => json(422, { message: "Validation Failed", errors: [{ message: "A pull request already exists for ana:nueva." }] });
    routes["GET /repos/ana/web/pulls"] = () => json(200, [{ number: 2, html_url: "https://github.com/ana/web/pull/2" }]);
    expect(await gh("pr create --title T --body B")).toEqual({ stdout: "", stderr: T.prExists("nueva", "main", "https://github.com/ana/web/pull/2"), exitCode: 1 });
  });

  it("list and view, as gh prints them without a terminal", async () => {
    const pr = { number: 3, title: "Arreglo", state: "open", draft: false, html_url: "https://github.com/ana/web/pull/3", head: { ref: "nueva" }, base: { ref: "main" }, user: { login: "ana" }, body: "Cuerpo", created_at: "2026-10-28T10:00:00Z", additions: 4, deletions: 1, merged_at: null, labels: [], assignees: [], requested_reviewers: [], milestone: null };
    routes["GET /repos/ana/web/pulls"] = () => json(200, [pr]);
    routes["GET /repos/ana/web/pulls/3"] = () => json(200, pr);
    expect((await gh("pr list")).stdout).toBe("3\tArreglo\tnueva\tOPEN\t2026-10-28T10:00:00Z\n");
    expect((await gh("pr view 3")).stdout).toBe(
      "title:\tArreglo\nstate:\tOPEN\nauthor:\tana\nlabels:\t\nassignees:\t\nreviewers:\t\nprojects:\t\nmilestone:\t\nnumber:\t3\nurl:\thttps://github.com/ana/web/pull/3\nadditions:\t4\ndeletions:\t1\nauto-merge:\tdisabled\n--\nCuerpo\n",
    );
    // Without a number: the current branch's.
    expect((await gh("pr view --json number,url")).stdout).toBe('{"number":3,"url":"https://github.com/ana/web/pull/3"}\n');
    routes["GET /repos/ana/web/pulls"] = () => json(200, []);
    expect(await gh("pr view")).toEqual({ stdout: "", stderr: T.noPrForBranch("nueva"), exitCode: 1 });
  });

  it("🔴 merge: a method is required; it merges; a viewer can't", async () => {
    let asked: unknown;
    routes["GET /repos/ana/web/pulls/3"] = () => json(200, { number: 3, head: { ref: "nueva", sha: "abc" } });
    routes["PUT /repos/ana/web/pulls/3/merge"] = (b) => ((asked = b), json(200, { merged: true }));
    expect(await gh("pr merge 3")).toEqual({ stdout: "", stderr: T.MERGE_METHOD_REQUIRED, exitCode: 1 });
    expect(await gh("pr merge 3 --squash")).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(asked).toEqual({ merge_method: "squash" });
    expect((await gh("pr merge 3 --squash", deps(), false)).stderr).toBe(T.PERMISSION_DENIED);
    routes["PUT /repos/ana/web/pulls/3/merge"] = () => json(405, { message: "Pull Request is not mergeable" });
    expect(await gh("pr merge 3 --merge")).toEqual({ stdout: "", stderr: "Pull request #3 is not mergeable: Pull Request is not mergeable\n", exitCode: 1 });
  });

  it("checks: each check's line; exit 1 if one fails, 8 if one is pending", async () => {
    routes["GET /repos/ana/web/pulls/3"] = () => json(200, { number: 3, head: { sha: "abc", ref: "nueva" } });
    const run = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion, html_url: `https://github.com/ana/web/runs/${name}`, started_at: "2026-10-28T10:00:00Z", completed_at: conclusion ? "2026-10-28T10:01:02Z" : null });
    routes["GET /repos/ana/web/commits/abc/check-runs"] = () => json(200, { check_runs: [run("build", "completed", "success"), run("test", "completed", "failure")] });
    routes["GET /repos/ana/web/commits/abc/status"] = () => json(200, { statuses: [] });
    expect(await gh("pr checks 3")).toEqual({
      stdout: "build\tpass\t1m2s\thttps://github.com/ana/web/runs/build\ntest\tfail\t1m2s\thttps://github.com/ana/web/runs/test\n",
      stderr: "",
      exitCode: 1,
    });
    routes["GET /repos/ana/web/commits/abc/check-runs"] = () => json(200, { check_runs: [run("build", "in_progress", null)] });
    expect((await gh("pr checks 3")).exitCode).toBe(8);
  });
});

describe("gh issue", () => {
  it("list and view (pull requests are not issues)", async () => {
    const issue = { number: 5, title: "Falla el menú", state: "open", html_url: "https://github.com/ana/web/issues/5", user: { login: "eva" }, body: "No abre", labels: [{ name: "bug" }], assignees: [], milestone: null, comments: 0, updated_at: "2026-10-28T11:00:00Z" };
    routes["GET /repos/ana/web/issues"] = () => json(200, [issue, { ...issue, number: 6, pull_request: {} }]);
    routes["GET /repos/ana/web/issues/5"] = () => json(200, issue);
    expect((await gh("issue list")).stdout).toBe("5\tOPEN\tFalla el menú\tbug\t2026-10-28T11:00:00Z\n");
    expect((await gh("issue view 5")).stdout).toBe("title:\tFalla el menú\nstate:\tOPEN\nauthor:\teva\nlabels:\tbug\ncomments:\t0\nassignees:\t\nprojects:\t\nmilestone:\t\nnumber:\t5\n--\nNo abre\n");
  });
});
