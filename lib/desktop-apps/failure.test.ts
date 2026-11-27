// @vitest-environment node
//
// WHY AN INSTALL ON THE DESKTOP SAID NO (spec local 2026-11-26-apps-en-el-escritorio, §4.1), in the person's terms: one
// cause per refusal and the one thing that fixes it, as Claude names a cause it knows ("its name was taken", "couldn't write
// a shortcut") and says «try again» only for what it doesn't. The card in the workspace and the strip in the window read it
// the same way.
import { describe, expect, it } from "vitest";

import { failureAction, failureOf, type DesktopFailure } from "./failure";

describe("failureOf — a known cause names itself, whatever the status", () => {
  it.each([
    [402, "plan_required", "plan_required"],
    [403, "owner_only", "owner_only"],
    [409, "not_an_app", "not_an_app"],
    [409, "uses_stripe", "uses_stripe"],
    [409, "tool_not_installed", "tool_not_installed"],
    [404, "desktop_apps_off", "desktop_apps_off"],
    [409, "desktop_app_removed", "removed"],
  ] as const)("%s %s → %s", (status, error, expected) => {
    expect(failureOf(status, error)).toBe(expected);
  });

  it("the gates' own: the security review's findings and its still-running answer, and a data change to confirm", () => {
    expect(failureOf(428, "security_findings")).toBe("security");
    expect(failureOf(428, "security_review_pending")).toBe("securityPending");
    expect(failureOf(428, "confirmation_required")).toBe("confirm");
    // A 428 nobody here knows is still a question for the workspace.
    expect(failureOf(428, "something_new")).toBe("confirm");
  });

  it("a 422 is a problem with the app (a build that doesn't compile, a manifest, a migration)", () => {
    expect(failureOf(422, "app_does_not_compile")).toBe("problem");
    expect(failureOf(422, "tool_manifest_invalid")).toBe("problem");
    // The gates' outcomes that carry no status of their own (functions that don't compile, a migration that failed).
    expect(failureOf(null, "functions_do_not_compile")).toBe("problem");
    expect(failureOf(null, "migration_failed")).toBe("problem");
  });

  it("🔴 «try again» is only for what is not known: a server error, the network, an answer nobody understood", () => {
    expect(failureOf(500, "install_failed")).toBe("failed");
    expect(failureOf(0, "network")).toBe("failed");
    expect(failureOf(502, undefined)).toBe("failed");
    expect(failureOf(404, "project_not_found")).toBe("failed");
    expect(failureOf(200, { not: "a code" })).toBe("failed");
  });

  it("a code of someone else's (prototype names, odd inputs) is not a cause", () => {
    expect(failureOf(500, "constructor")).toBe("failed");
    expect(failureOf(500, "__proto__")).toBe("failed");
    expect(failureOf(500, "toString")).toBe("failed");
  });
});

describe("failureAction — the one thing that fixes it", () => {
  const action = (f: DesktopFailure) => failureAction(f);

  it("a plan is fixed with a plan; a tool that isn't installed, in Tools", () => {
    expect(action("plan_required")).toBe("pricing");
    expect(action("tool_not_installed")).toBe("tools");
  });

  it("what the workspace has to look at (a finding, a confirmation, a build) goes to the project, and so does an unknown failure", () => {
    for (const f of ["security", "securityPending", "confirm", "problem", "failed"] as const) expect(action(f)).toBe("project");
  });

  it("what nobody can fix from here has no button: the reason is all there is", () => {
    for (const f of ["owner_only", "not_an_app", "uses_stripe", "desktop_apps_off", "removed"] as const) expect(action(f)).toBeNull();
  });
});
