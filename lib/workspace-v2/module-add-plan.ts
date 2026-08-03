// Decision core for "add a module from the Library": which steps run, in
// order. Pure — page.tsx executes them with its existing handlers
// (update*Settings / insert*Section / createModulePage). The comments module
// requires Cuentas (server rule reconcileModuleSettings): with members off,
// one click enables both. Platforms breaks the "activo = settings.enabled"
// assumption: its state is the business profile's links.

export type ContentModule = "collections" | "bookings" | "comments" | "platforms";
export type ModuleDestination = "section" | "page";

export type ModuleAddStep =
  | { kind: "enableMembers" }
  | { kind: "enableModule"; module: ContentModule }
  | { kind: "insertSection"; module: ContentModule }
  | { kind: "createPage"; module: "collections" | "bookings" }
  | { kind: "scrollToExisting"; module: ContentModule }
  | { kind: "openBusinessProfile" };

export function planModuleAdd(input: {
  module: ContentModule;
  destination: ModuleDestination;
  moduleEnabled: boolean;
  membersEnabled: boolean;
  activePageHasBand: boolean;
  /** platforms only: the business profile carries at least one link. This
   *  module has no settings.<key>.enabled — its "on" state IS that data. */
  hasPlatformLinks?: boolean;
}): ModuleAddStep[] {
  if (
    (input.module === "comments" || input.module === "platforms") &&
    input.destination === "page"
  ) {
    throw new Error(`${input.module} has no page surface`);
  }
  if (input.destination === "section" && input.activePageHasBand) {
    return [{ kind: "scrollToExisting", module: input.module }];
  }
  // Platforms' prerequisite can't be auto-resolved — nobody can invent a
  // social account for the user — so a missing one DIVERTS to Mi negocio
  // instead of inserting an empty band that publish would delete anyway.
  if (input.module === "platforms") {
    return input.hasPlatformLinks
      ? [{ kind: "insertSection", module: "platforms" }]
      : [{ kind: "openBusinessProfile" }];
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
