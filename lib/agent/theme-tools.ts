// LEN MAKES THEMES AND APPLIES THEM (spec local 2026-11-27-temas-del-workspace, §4.4–4.5). Two pieces, both as Claude
// Code does them:
//
// - `set_theme` is `/custom-theme <name> [session]` / `off`: it saves the pick of whoever SPEAKS (`personOf`) — a member's
//   choice is the member's own view, never the owner's — for all their OpenLen («everywhere») or over it for this project.
//   The name is a ref (`bundled:<id>`, `installed:<installation>:<id>`) or, as `/custom-theme` takes it, the id as the list
//   prints it or the title, in any case. `chooseTheme` is the door, the same one the picker uses.
// - `publish` in a theme project INSTALLS it for the speaker (`installTheme`) and answers with what the install said — the
//   cost of each scene, the glass as raised to read, the reduced-motion rule added — instead of publishing a site: the
//   project's /locale, /themes and preview page would otherwise ship as a website. Only the owner installs it.
//
// Server work is imported lazily: the declaration is read wherever Len's catalog is built.
import { personOf } from "@/lib/agent/person";
import type { AgentSession, ToolOutcome } from "@/lib/agent/tools";
import type { ChooseThemeResult } from "@/lib/themes/resolve";

export const SET_THEME = "set_theme";

export const SET_THEME_DECLARATION = {
  name: SET_THEME,
  description:
    'Applies a workspace theme for the person you are talking to, like /custom-theme: the scene behind their OpenLen with its glass, or a still ground, a palette or a font. It changes only how OpenLen looks to them — never a page, never anyone else. `theme` is a theme\'s ref, its id as listed or its title (any case): a gallery theme is `bundled:<id>` (e.g. "bundled:honu-lagoon"), one they installed is `installed:<installation id>:<theme id>` (the refs `publish` returns in a theme project). "off" clears the pick of that scope. Use it when they ask for a theme, or to show them one you just installed.',
  parameters: {
    type: "OBJECT",
    properties: {
      theme: { type: "STRING", description: 'The theme\'s ref, id or title; "off" clears.' },
      scope: {
        type: "STRING",
        enum: ["everywhere", "project"],
        description: '"everywhere": all of their OpenLen. "project": only this project, over the everywhere pick.',
      },
    },
    required: ["theme", "scope"],
  },
};

/** One theme the speaker can use right now, as the picker lists it. */
export interface UsableTheme {
  readonly ref: string;
  readonly title: string;
  readonly source: "bundled" | "installed";
}

export interface SetThemeDeps {
  enabled(): boolean;
  /** What the speaker can choose (`themeState(...).available`). */
  available(personId: string, projectId: string, locale: string): Promise<readonly UsableTheme[]>;
  choose(personId: string, choice: { scope: "everywhere" | "project"; projectId?: string; themeRef: string | null }): Promise<ChooseThemeResult>;
}

async function realSetThemeDeps(): Promise<SetThemeDeps> {
  const [{ themesEnabled }, resolve] = await Promise.all([import("@/lib/themes/enabled"), import("@/lib/themes/resolve")]);
  return {
    enabled: () => themesEnabled(),
    available: async (personId, projectId, locale) => (await resolve.themeState(personId, projectId, locale)).available,
    choose: (personId, choice) => resolve.chooseTheme(personId, choice),
  };
}

/** A ref as given, or the one theme a name stands for. Several themes under one name: `ambiguous`, with their refs. */
function refFor(name: string, available: readonly UsableTheme[]): { ref: string } | { ambiguous: string[] } | null {
  if (available.some((t) => t.ref === name)) return { ref: name };
  const wanted = name.trim().toLowerCase();
  const byId = available.filter((t) => t.ref.slice(t.ref.lastIndexOf(":") + 1).toLowerCase() === wanted);
  const matches = byId.length > 0 ? byId : available.filter((t) => t.title.trim().toLowerCase() === wanted);
  if (matches.length === 1) return { ref: matches[0]!.ref };
  if (matches.length > 1) return { ambiguous: matches.map((t) => t.ref) };
  return null;
}

export async function runSetTheme(session: AgentSession, args: Record<string, unknown>, deps?: SetThemeDeps): Promise<ToolOutcome> {
  const scope = args.scope;
  if (scope !== "everywhere" && scope !== "project") return { response: { error: "bad_scope", message: 'scope is "everywhere" or "project".' } };
  // Ruling R24: a theme changes a person's view only in a turn they started — never in a scheduled task, Len Watch, a goal
  // round, a turn an agent's message woke, or one on a copy of the project. The person's own assistant talking with its
  // owner is a turn they started.
  if (session.unattended || session.wokenByAgent || session.inProjectCopy) {
    return { response: { error: "unattended", message: "A theme is applied only in a turn the person started: tell them how to apply it instead." } };
  }
  const theme = typeof args.theme === "string" ? args.theme.trim() : "";
  if (!theme) return { response: { error: "unknown_theme" } };
  const d = deps ?? (await realSetThemeDeps());
  if (!d.enabled()) return { response: { error: "themes_off" } };

  const personId = personOf(session);
  const where: { scope: "everywhere" | "project"; projectId?: string } = scope === "project" ? { scope, projectId: session.projectId } : { scope };
  let themeRef: string | null = null;
  if (theme.toLowerCase() !== "off") {
    const found = refFor(theme, await d.available(personId, session.projectId, session.uiLocale ?? "en"));
    if (found && "ambiguous" in found) return { response: { error: "ambiguous_theme", refs: found.ambiguous } };
    // A ref nobody lists still goes to the door, which says unknown_theme without saying which way it is not.
    themeRef = found ? found.ref : theme;
  }
  const chosen = await d.choose(personId, { ...where, themeRef });
  if (!chosen.ok) return { response: { error: chosen.error } };
  return { response: { applied: themeRef, scope } };
}

type InstallAnswer = { status: number; body: Record<string, unknown> };
type Install = (i: { projectId: string; actorId: string; locale: string }) => Promise<InstallAnswer>;

const NOT_INSTALLED: Readonly<Record<number, string>> = {
  403: "Only the project's owner installs its themes: ask them to publish it. Nothing was installed.",
  404: "Themes are off on this server: nothing was installed.",
  409: "This project isn't a theme project: nothing was installed.",
  422: "Nothing was installed: fix these problems and call publish again.",
  429: "An install of theirs is still running: wait for it to finish before calling publish again. Nothing new was installed.",
};

/** Len's `publish` in a theme project: the install, for the speaker, with each theme's ref for `set_theme`. */
export async function publishTheme(session: AgentSession, install?: Install): Promise<ToolOutcome> {
  const run: Install = install ?? (async (i) => (await import("@/lib/themes/install")).installTheme(i));
  const { status, body } = await run({ projectId: session.projectId, actorId: personOf(session), locale: session.uiLocale ?? "en" });
  if (status !== 200) {
    return { response: { ok: false, ...body, message: NOT_INSTALLED[status] ?? "The theme couldn't be installed: nothing was installed." } };
  }
  const installationId = (body.installation as { id?: unknown } | undefined)?.id;
  const themes = Array.isArray(body.themes)
    ? (body.themes as Record<string, unknown>[]).map((t) => (typeof installationId === "string" ? { ...t, ref: `installed:${installationId}:${String(t.id)}` } : t))
    : body.themes;
  return { response: { ok: true, ...body, themes } };
}
