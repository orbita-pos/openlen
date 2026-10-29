import { NextResponse, type NextRequest } from "next/server";

import { auth } from "@/auth";
import { exchangeUserCode, INSTALL_STATE_COOKIE as STATE_COOKIE, userInstallation, verifyInstallState } from "@/lib/integrations/github-app";
import { saveInstallation } from "@/lib/integrations/github-app-store";
import { publicOrigin } from "@/lib/integrations/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/integrations/github-app/callback?installation_id=…&code=…&state=…
// Where GitHub sends the person after installing the App (with «Request user authorization during installation»).
// An installation id in a URL proves nothing, so the person's own user token —from `code`— must list it; then the
// row is kept and the user token is dropped: OpenLen works with the installation's tokens only.

function backToProject(state: { projectId: string; locale: string }, param: "github" | "github_error", value: string): NextResponse {
  const to = new URL(`/${state.locale}/new`, publicOrigin());
  to.searchParams.set("project", state.projectId);
  to.searchParams.set(param, value);
  const res = NextResponse.redirect(to);
  res.cookies.set(STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = req.nextUrl.searchParams;
  const given = q.get("state") ?? "";
  const state = verifyInstallState(given);
  const session = await auth();
  if (!state || req.cookies.get(STATE_COOKIE)?.value !== given || session?.user?.id !== state.userId) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }
  const code = q.get("code");
  const installationId = Number(q.get("installation_id"));
  if (!code || !Number.isSafeInteger(installationId) || installationId <= 0) return backToProject(state, "github_error", "denied");
  const userToken = await exchangeUserCode(code);
  if (!userToken) return backToProject(state, "github_error", "exchange");
  const installation = await userInstallation(userToken, installationId);
  if (!installation) return NextResponse.json({ error: "installation_not_yours" }, { status: 403 });
  await saveInstallation(state.userId, installation);
  return backToProject(state, "github", "connected");
}
