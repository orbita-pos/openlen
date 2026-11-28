// THE SCENE, SERVED AS AN IMAGE THAT RUNS NOTHING (spec local 2026-11-27-temas-del-workspace, §5.2): `GET /api/themes/scene?
// ref=<themeRef>&still=0|1&v=<releaseSha>`. The workspace paints a scene in an <img> behind the glass, and a scene is
// somebody's SVG — Len's, or anyone's who sent a project — so it is served the way nothing in it can act even if it is
// opened as a page of its own: `nosniff`, a CSP with no script, no network and a `sandbox`, and a type that is an image.
// What it serves is only ever text a gate already passed: a bundled scene goes through `checkScene` here (those files are
// Claude Code's own, byte for byte, so they have not had the gate's reduced-motion rule put in), and an installed one was
// checked when it was installed and sits in its version as the checked text.
//
// WHO MAY SEE WHAT. `bundled:<id>` is OpenLen's own gallery: anyone. `installed:<installationId>:<themeId>` is served to
// the person whose installation it is, and only while it is not removed, from the installation's CURRENT version; to
// anyone else — another person, nobody, a removed one, a theme that is not there, a theme with no scene — it is a 404
// with an empty body that says nothing about which of those it was.
//
// CACHING (controller ruling R16). The 404 gate is only worth something if no shared cache can answer around it, so an
// installed scene is never `public`. `v` is never what is looked up — the version served is the installation's — it is
// only what decides how long the answer is kept: the URL the workspace builds (`?v=<releaseSha>`) changes with the
// version, so when `v` IS the installation's current releaseSha the answer under that URL can never change and the
// person's own cache keeps it a year (`private, immutable`). Without `v`, or with one that is not the current version
// (an old URL after a reinstall, or a made-up one), the answer may change under that URL, so it is not kept
// (`private, no-cache`). The gallery's scenes are OpenLen's own and public: a day, in any cache.
import "server-only";

import { bundledSceneSvg } from "./bundled";
import { themesEnabled } from "./enabled";
import { checkScene, stillScene } from "./scene-check";
import type { ThemeInstallationRow, ThemeRelease } from "./store";

/** What a browser may do with the scene when it is opened on its own: nothing (no script, no fetch, no frame, a sandbox). */
const SCENE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

/** A ref no longer than this is not one of ours (`installed:<uuid>:<a theme id>` is under 100). */
const REF_MAX_LENGTH = 200;

/** How long, and by whom, a scene may be kept. */
export type SceneCache = "bundled" | "installed-versioned" | "no-cache";

const CACHE_CONTROL: Readonly<Record<SceneCache, string>> = {
  // OpenLen's own gallery, the same bytes for everyone: any cache, for a day (a regenerated scene reaches people tomorrow).
  bundled: "public, max-age=86400",
  // An owner-gated scene under a URL that names its version: only the owner's own browser, for a year.
  "installed-versioned": "private, max-age=31536000, immutable",
  "no-cache": "private, no-cache",
};

/** The scene as an SVG response. With `still`, the scene that does not move; `cache` says how it may be kept. */
export function sceneResponse(svg: string, o: { still: boolean; cache: SceneCache }): Response {
  return new Response(o.still ? stillScene(svg) : svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": SCENE_CSP,
      "Cache-Control": CACHE_CONTROL[o.cache],
    },
  });
}

/** The answer to everything that is not a scene for this asker: nothing, and not kept anywhere. */
function notFound(): Response {
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}

const checkedBundled = new Map<string, string>();

/**
 * A bundled theme's scene after the gate (so it carries the reduced-motion rule like an installed one), kept in memory:
 * the files are immutable. Null for an id that is not in the gallery. A scene the gate refuses is never kept and never
 * served — `bundled.test.ts` holds that none does, so this is a broken build, not a case.
 */
export function checkedBundledScene(id: string): string | null {
  const kept = checkedBundled.get(id);
  if (kept !== undefined) return kept;
  const raw = bundledSceneSvg(id);
  if (raw === null) return null;
  const checked = checkScene(raw, `${id}.svg`);
  if (!checked.ok) return null;
  checkedBundled.set(id, checked.svg);
  return checked.svg;
}

export interface SceneServeDeps {
  enabled(): boolean;
  /** The signed-in person (Auth.js), or null. Only asked for an installed theme: a bundled one needs no session. */
  sessionPersonId(): Promise<string | null>;
  /** A bundled theme's checked scene, or null. */
  bundledScene(id: string): string | null;
  /** Every installation of a person, removed ones included. */
  listInstallations(personId: string): Promise<ThemeInstallationRow[]>;
  readRelease(sha: string): Promise<ThemeRelease | null>;
}

export function realSceneServeDeps(): SceneServeDeps {
  return {
    enabled: () => themesEnabled(),
    sessionPersonId: async () => {
      const { auth } = await import("@/auth");
      return (await auth())?.user?.id ?? null;
    },
    bundledScene: checkedBundledScene,
    listInstallations: async (personId) => (await import("./store")).listThemeInstallations(personId),
    readRelease: async (sha) => (await import("./store")).readThemeRelease(sha),
  };
}

type ParsedRef = { kind: "bundled"; id: string } | { kind: "installed"; installationId: string; themeId: string };

function parseRef(ref: string | null): ParsedRef | null {
  if (ref === null || ref.length === 0 || ref.length > REF_MAX_LENGTH) return null;
  const parts = ref.split(":");
  if (parts[0] === "bundled" && parts.length === 2 && parts[1]) return { kind: "bundled", id: parts[1] };
  if (parts[0] === "installed" && parts.length === 3 && parts[1] && parts[2]) {
    return { kind: "installed", installationId: parts[1], themeId: parts[2] };
  }
  return null;
}

export async function serveThemeScene(
  input: { ref: string | null; still: boolean; v: string | null },
  deps: SceneServeDeps,
): Promise<Response> {
  if (!deps.enabled()) return notFound();
  const ref = parseRef(input.ref);
  if (!ref) return notFound();

  if (ref.kind === "bundled") {
    const svg = deps.bundledScene(ref.id);
    return svg === null ? notFound() : sceneResponse(svg, { still: input.still, cache: "bundled" });
  }

  const personId = await deps.sessionPersonId();
  if (!personId) return notFound();
  const installation = (await deps.listInstallations(personId)).find((row) => row.id === ref.installationId && row.personId === personId);
  if (!installation || installation.removedAt !== null) return notFound();
  const release = await deps.readRelease(installation.releaseSha);
  const scene = release?.themes.find((theme) => theme.id === ref.themeId)?.scene;
  if (!scene) return notFound();
  // `v` decides only how long the answer is kept: a year when it names the version being served, never otherwise.
  return sceneResponse(scene, { still: input.still, cache: input.v === installation.releaseSha ? "installed-versioned" : "no-cache" });
}
