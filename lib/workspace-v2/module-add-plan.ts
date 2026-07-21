// Decision core for "add a module from the Library": which steps run, in
// order. Pure — page.tsx executes them with its existing handlers
// (update*Settings / insert*Section / createModulePage). The comments module
// requires Cuentas (server rule reconcileModuleSettings): with members off,
// one click enables both.

export type ContentModule = "collections" | "bookings" | "comments";
export type ModuleDestination = "section" | "page";

export type ModuleAddStep =
  | { kind: "enableMembers" }
  | { kind: "enableModule"; module: ContentModule }
  | { kind: "insertSection"; module: ContentModule }
  | { kind: "createPage"; module: "collections" | "bookings" }
  | { kind: "scrollToExisting"; module: ContentModule };

export function planModuleAdd(input: {
  module: ContentModule;
  destination: ModuleDestination;
  moduleEnabled: boolean;
  membersEnabled: boolean;
  activePageHasBand: boolean;
}): ModuleAddStep[] {
  if (input.module === "comments" && input.destination === "page") {
    throw new Error("comments has no page surface");
  }
  if (input.destination === "section" && input.activePageHasBand) {
    return [{ kind: "scrollToExisting", module: input.module }];
  }
  const steps: ModuleAddStep[] = [];
  if (!input.moduleEnabled) {
    if (input.module === "comments" && !input.membersEnabled) {
      steps.push({ kind: "enableMembers" });
    }
    steps.push({ kind: "enableModule", module: input.module });
  }
  if (input.destination === "page") {
    steps.push({ kind: "createPage", module: input.module as "collections" | "bookings" });
  } else {
    steps.push({ kind: "insertSection", module: input.module });
  }
  return steps;
}
