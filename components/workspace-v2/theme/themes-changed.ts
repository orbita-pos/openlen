// WHEN LEN CHANGED WHICH THEME THE WORKSPACE PAINTS (spec local 2026-11-27-temas-del-workspace, §4.4–4.5): a `set_theme`
// that went through saved a pick, and a `publish` that went through in a theme project installed a new version — either
// way the layer behind the workspace has to read `/api/themes` again, or it keeps painting what was there before the turn.
// The chat calls this for every settled tool card (`use-agent-chat.ts`).
//
// A failed call settles as `error` (the loop reads `ok: false`), so it reloads nothing. A `publish` elsewhere — a site, a
// tool — also reloads: the chat does not know which kind of project it is in, and reading the themes again when nothing
// changed is one GET that paints the same.
export function themesChangedBy(tool: string, status: string): boolean {
  if (status !== "done" && status !== "warning") return false;
  return tool === "set_theme" || tool === "publish";
}
