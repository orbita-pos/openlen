// WHAT ALREADY EXISTS (spec local 2026-11-04-herramientas-hechas-por-len, §4.10): the list the `tool-suggestions` skill
// carries, as DeepSeek's `personalized-pages` appends its official plugins as JSON after its instructions
// (creation-recommendations/src/skill.ts) — so Len names an OpenLen feature or an installed tool instead of proposing a
// duplicate. Pure.
import type { InstalledToolView } from "../types";

/** OpenLen's own features a tool could duplicate, by the name the person sees. */
export const BUILT_INS: readonly { readonly name: string; readonly what: string }[] = [
  { name: "Resultados", what: "A project's visits and its form submissions, by day, page and source." },
  { name: "Bandeja", what: "The inbox: messages and chats from a site's visitors, answered there." },
  { name: "Tareas programadas", what: "Len runs a request on a schedule (every Monday at 9…) and emails the result." },
  { name: "Len que avisa", what: "Len watches a source (forms, visits, GitHub, sign-ups…) and leaves a card when something needs the person." },
  { name: "Base de datos", what: "An app's tables, rows, users and payments, viewed and edited." },
  { name: "Versiones", what: "A project's saved versions, and going back to one." },
  { name: "Herramientas", what: "The person's installed tools: switched on or off, removed, restored, opened in their project." },
];

export function suggestionCatalog(o: { readonly installed: readonly InstalledToolView[] }): string {
  const installedTools = o.installed
    .filter((t) => t.status !== "removed")
    .map((t) => ({ title: t.title, description: t.description, placement: t.placement, enabled: t.enabled }));
  return `## What already exists in OpenLen\n\n${JSON.stringify({ openlen: BUILT_INS, installedTools })}`;
}
