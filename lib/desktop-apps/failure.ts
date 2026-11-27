// WHY AN INSTALL ON THE DESKTOP SAID NO (spec local 2026-11-26-apps-en-el-escritorio, §4.1), in the person's terms — read by the
// card in the workspace and the strip in the window, so both say the same thing. As Claude's «Couldn't install {app}.» does:
// the headline is always the same, the reason is specific when the cause is known and the one action that fixes it is named;
// «try again» is for a failure nobody understands (a server error, the network). Pure and client-safe.

export type DesktopFailure =
  // Refusals that will not change by trying again: each its own reason.
  | "plan_required"
  | "owner_only"
  | "not_an_app"
  | "uses_stripe"
  | "tool_not_installed"
  | "desktop_apps_off"
  /** The window of an app that was removed from the desktop elsewhere (`fromWindow` → `desktop_app_removed`). */
  | "removed"
  // The gates' questions: the workspace has the dialogs (`lib/tools/install-core.ts`, `publish-through-gates.ts`).
  | "security"
  | "securityPending"
  | "confirm"
  /** The app has a problem that stops it (a build that doesn't compile, a manifest, a migration). */
  | "problem"
  /** Nothing is known of it: a server error, the network. */
  | "failed";

// An own-property lookup on a null-prototype table: «constructor» or «__proto__» are not codes.
const BY_CODE: Readonly<Record<string, DesktopFailure>> = Object.assign(Object.create(null) as Record<string, DesktopFailure>, {
  plan_required: "plan_required",
  owner_only: "owner_only",
  not_an_app: "not_an_app",
  uses_stripe: "uses_stripe",
  tool_not_installed: "tool_not_installed",
  desktop_apps_off: "desktop_apps_off",
  desktop_app_removed: "removed",
  security_findings: "security",
  security_review_pending: "securityPending",
  confirmation_required: "confirm",
});

/** The cause behind an answer of the install route. `status` is the HTTP status, or null for a gate's own outcome that
 *  carries none (functions that don't compile, a migration that failed — all problems with the app). */
export function failureOf(status: number | null, error: unknown): DesktopFailure {
  const known = typeof error === "string" ? BY_CODE[error] : undefined;
  if (known) return known;
  // A 428 nobody here knows is still a question for the workspace's dialogs.
  if (status === 428) return "confirm";
  return status === 422 || status === null ? "problem" : "failed";
}

export type FailureAction =
  /** The plans page. */
  | "pricing"
  /** The Tools page, where the tool is installed first. */
  | "tools"
  /** The project in OpenLen, where the gates' dialogs live. */
  | "project";

/** The one thing that fixes it, or null when the reason is all there is to say. */
export function failureAction(failure: DesktopFailure): FailureAction | null {
  switch (failure) {
    case "plan_required":
      return "pricing";
    case "tool_not_installed":
      return "tools";
    case "security":
    case "securityPending":
    case "confirm":
    case "problem":
    case "failed":
      return "project";
    default:
      return null;
  }
}
