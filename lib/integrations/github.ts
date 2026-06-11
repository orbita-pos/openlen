import { ProviderError } from "./oauth";

// ─────────────────────────────────────────────────────────────────────────────
// GitHub deploy driver — push the project's static files (index.html + one
// <slug>/index.html per site page) to a repo in the connected user's account
// and enable GitHub Pages. Plain fetch (no @octokit) to stay symmetric with
// the Vercel driver and add zero dependencies.
//
// Flow: GET /user (owner) → POST /user/repos (tolerate 422 "exists") →
// GET /repos/.. (default branch) → per file: GET .../contents/<path> (capture
// sha if present) → PUT .../contents/<path> (base64 body; sha only on update)
// → delete <slug>/index.html files left over from since-deleted pages →
// POST .../pages (tolerate 409 already-enabled).
// ─────────────────────────────────────────────────────────────────────────────

const API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function ghHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "OpenLen-Deploy",
  };
}

async function ghBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function fail(res: Response, body: Record<string, unknown>, fallback: string): never {
  const msg = typeof body.message === "string" ? body.message : fallback;
  throw new ProviderError("github", msg, res.status === 401 ? 401 : 502);
}

export interface GitHubDeployResult {
  liveUrl: string;
  remoteName: string;
  owner: string;
}

export async function deployToGitHub(
  token: string,
  name: string,
  files: Array<{ path: string; content: string }>,
): Promise<GitHubDeployResult> {
  // 1. Resolve the owner login.
  const userRes = await fetch(`${API}/user`, { headers: ghHeaders(token) });
  const user = await ghBody(userRes);
  if (!userRes.ok) fail(userRes, user, "Could not read your GitHub account.");
  const owner = typeof user.login === "string" ? user.login : "";
  if (!owner) throw new ProviderError("github", "GitHub account has no login.", 502);

  // 2. Create the repo. 422 = already exists ⇒ reuse it (re-deploy).
  const createRes = await fetch(`${API}/user/repos`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description: "Published with OpenLen",
      private: false,
      auto_init: false,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  });
  if (!createRes.ok && createRes.status !== 422) {
    fail(createRes, await ghBody(createRes), "Could not create the repository.");
  }

  // 3. Default branch (an empty repo still reports its future default, e.g. "main").
  const repoRes = await fetch(`${API}/repos/${owner}/${name}`, { headers: ghHeaders(token) });
  const repo = await ghBody(repoRes);
  const branch = typeof repo.default_branch === "string" ? repo.default_branch : "main";

  // 4. Commit every file (content MUST be base64). The contents API needs the
  // existing blob sha to update; 404 on an empty/new repo or new path ⇒ create.
  // Sequential on purpose — parallel PUTs to the same branch race on the head
  // commit and GitHub rejects the losers with 409s.
  for (const f of files) {
    let sha: string | undefined;
    const getRes = await fetch(
      `${API}/repos/${owner}/${name}/contents/${f.path}`,
      { headers: ghHeaders(token) },
    );
    if (getRes.ok) {
      const existing = await ghBody(getRes);
      if (typeof existing.sha === "string") sha = existing.sha;
    }
    const putRes = await fetch(
      `${API}/repos/${owner}/${name}/contents/${f.path}`,
      {
        method: "PUT",
        headers: { ...ghHeaders(token), "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Deploy from OpenLen",
          content: Buffer.from(f.content, "utf8").toString("base64"),
          ...(sha ? { sha } : {}),
        }),
      },
    );
    if (!putRes.ok) {
      fail(putRes, await ghBody(putRes), `Could not commit ${f.path}.`);
    }
  }

  // 5. Remove <slug>/index.html files from site pages deleted since the last
  // deploy, so their URLs don't stay live. Strictly scoped to that path shape
  // and never index.html itself — files the user added by hand are untouched.
  // Soft: a stale page is cosmetic, cleanup must never fail the deploy.
  try {
    const keep = new Set(files.map((f) => f.path));
    const treeRes = await fetch(
      `${API}/repos/${owner}/${name}/git/trees/${branch}?recursive=1`,
      { headers: ghHeaders(token) },
    );
    if (treeRes.ok) {
      const tree = await ghBody(treeRes);
      const entries = Array.isArray(tree.tree) ? tree.tree : [];
      for (const raw of entries) {
        const entry = raw as { path?: unknown; sha?: unknown };
        const path = typeof entry.path === "string" ? entry.path : "";
        const blobSha = typeof entry.sha === "string" ? entry.sha : "";
        if (!path || !blobSha || keep.has(path)) continue;
        if (!/^[a-z0-9][a-z0-9-]*\/index\.html$/.test(path)) continue;
        await fetch(`${API}/repos/${owner}/${name}/contents/${path}`, {
          method: "DELETE",
          headers: { ...ghHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "Remove deleted page (OpenLen)",
            sha: blobSha,
          }),
        }).catch(() => {});
      }
    }
  } catch {
    /* soft */
  }

  // 6. Enable GitHub Pages from the default branch root. 409 = already enabled.
  const pagesRes = await fetch(`${API}/repos/${owner}/${name}/pages`, {
    method: "POST",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ source: { branch, path: "/" } }),
  });
  if (!pagesRes.ok && pagesRes.status !== 409) {
    fail(pagesRes, await ghBody(pagesRes), "Could not enable GitHub Pages.");
  }

  // A repo literally named "<owner>.github.io" is the user's root site.
  const isRootSite = name.toLowerCase() === `${owner}.github.io`.toLowerCase();
  return {
    owner,
    remoteName: name,
    liveUrl: isRootSite
      ? `https://${owner}.github.io/`
      : `https://${owner}.github.io/${name}/`,
  };
}
