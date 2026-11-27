// THE REAL DEPENDENCIES OF A DESKTOP INSTALL (spec local 2026-11-26-apps-en-el-escritorio). The gates are the tool
// install's own (`realInstallDeps`: the same security review, build, functions, data changes and release row — not
// copied), and the rest is the desktop's. Apart from `install.ts` so a route's test can swap it for in-memory ones.
import "server-only";

import { desktopHostLabel } from "@/lib/tools/host";

import { desktopAppsEnabled } from "./enabled";
import type { DesktopDeps } from "./install";

/** The private host's label of a new row. 🔴 Throws without Auth.js's secret — the label is an HMAC of it — so a row
 *  never gets an empty one (a tool's install does the same, with its own domain). */
export function hostLabelOrThrow(id: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const label = desktopHostLabel(id, env);
  if (!label) throw new Error("installDesktopApp: AUTH_SECRET is not set, so a desktop app has no private host");
  return label;
}

export async function realDesktopDeps(): Promise<DesktopDeps> {
  const [{ realInstallDeps }, { eq }, db, store, toolStore, stripeOn] = await Promise.all([
    import("@/lib/tools/install"),
    import("drizzle-orm"),
    import("@/lib/db"),
    import("./store"),
    import("@/lib/tools/store"),
    import("@/lib/stripe/enabled"),
  ]);
  const base = await realInstallDeps();
  return {
    // The gates, as a tool's install has them.
    securityGate: base.securityGate,
    entorno: base.entorno,
    build: base.build,
    prepareFunctions: base.prepareFunctions,
    dataChanges: base.dataChanges,
    saveRelease: base.saveRelease,
    markPublished: base.markPublished,
    // The checks before them: the same plan, access and files a tool's install reads.
    plan: base.plan,
    access: base.access,
    files: base.files,
    enabled: () => desktopAppsEnabled(),
    loadProject: async (projectId) => {
      const [row] = await db.db
        .select({ title: db.schema.projects.title, subdomain: db.schema.projects.subdomain, data: db.schema.projects.data })
        .from(db.schema.projects)
        .where(eq(db.schema.projects.id, projectId))
        .limit(1);
      return row ?? null;
    },
    // `stripeStateFor` is null for a project with no Stripe account in either mode and no webhook endpoint.
    usesStripe: async (projectId) => stripeOn.stripeEnabled() && (await (await import("@/lib/stripe/state")).stripeStateFor(projectId)) !== null,
    toolInstallation: (personId, projectId) => toolStore.installationOf(personId, projectId),
    releaseExists: toolStore.releaseExists,
    desktopAppOf: store.desktopAppOf,
    hasActiveDesktopApp: store.hasActiveDesktopApp,
    upsertDesktopApp: store.upsertDesktopApp,
    markRemoved: store.markDesktopAppRemoved,
    hostLabelFor: (id) => hostLabelOrThrow(id),
  };
}
