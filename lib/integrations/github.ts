import { ProviderError } from "./oauth";

// ─────────────────────────────────────────────────────────────────────────────
// GitHub deploy driver — push the project's static index.html to a repo in the
// connected user's account and enable GitHub Pages. Plain fetch (no @octokit)
// to stay symmetric with the Vercel driver and add zero dependencies.
//
// Flow: GET /user (owner) → POST /user/repos (tolerate 422 "exists") →
// GET /repos/.. (default branch) → GET .../contents/index.html (capture sha if
// present) → PUT .../contents/index.html (base64 body; sha only on update) →
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
  html: string,
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

  // 4. Existing index.html sha (for update). 404 on an empty/new repo ⇒ create.
  let sha: string | undefined;
  const getRes = await fetch(`${API}/repos/${owner}/${name}/contents/index.html`, {
    headers: ghHeaders(token),
  });
  if (getRes.ok) {
    const existing = await ghBody(getRes);
    if (typeof existing.sha === "string") sha = existing.sha;
  }

  // 5. Commit index.html (content MUST be base64).
  const putRes = await fetch(`${API}/repos/${owner}/${name}/contents/index.html`, {
    method: "PUT",
    headers: { ...ghHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Deploy from OpenLen",
      content: Buffer.from(html, "utf8").toString("base64"),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!putRes.ok) fail(putRes, await ghBody(putRes), "Could not commit index.html.");

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
