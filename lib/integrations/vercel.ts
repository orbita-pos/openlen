import { ProviderError } from "./oauth";

// ─────────────────────────────────────────────────────────────────────────────
// Vercel deploy driver — POST the project's static index.html inline to the
// Deployments API and return the live URL. Plain fetch, no SDK.
//
// Re-deploying with the same `name` updates the same Vercel project. We don't
// poll readyState: a single static file is READY within a couple of seconds,
// and the returned production alias resolves as soon as the build settles.
// ─────────────────────────────────────────────────────────────────────────────

export interface VercelDeployResult {
  liveUrl: string;
  remoteName: string;
}

export async function deployToVercel(
  token: string,
  teamId: string | null,
  name: string,
  html: string,
): Promise<VercelDeployResult> {
  const url = new URL("https://api.vercel.com/v13/deployments");
  if (teamId) url.searchParams.set("teamId", teamId);
  url.searchParams.set("forceNew", "1");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      files: [{ file: "index.html", data: html }],
      projectSettings: { framework: null },
      target: "production",
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    url?: string;
    alias?: string[];
    error?: { message?: string };
  };
  if (!res.ok || !data.url) {
    throw new ProviderError(
      "vercel",
      data.error?.message || `Vercel deploy failed (${res.status}).`,
      res.status === 401 ? 401 : 502,
    );
  }

  // Prefer the stable production alias (name.vercel.app) when present; fall
  // back to the immutable per-deployment host.
  const host = (data.alias && data.alias[0]) || data.url;
  return { liveUrl: `https://${host}`, remoteName: name };
}
