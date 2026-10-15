// Who signs a commit (spec §1): the person's name, and a noreply address — never their real email,
// because the address is part of the commit's hash and phase 2 pushes commits to GitHub.
import type { GitIdentity } from "./command";

export function gitIdentity(userId: string, user: { readonly name: string | null; readonly handle: string | null } | null): GitIdentity {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/[<>\n]/g, "").trim();
  return {
    name: clean(user?.name) || clean(user?.handle) || "OpenLen user",
    email: `${user?.handle ?? userId}@users.noreply.openlen.com`,
  };
}
