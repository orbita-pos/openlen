// THE TEXTS THE WINDOW SENDS TO THE BROWSER (spec local 2026-11-26-apps-en-el-escritorio, §4.3): the window is a client page
// outside the locale layout, so it gets only what it reads — not the workspace's whole `wsChrome`.
//   · its own (`wsChrome.desktop`): the strip, the install card, the notices;
//   · for a TOOL, the texts of what OpenLen draws around its frame (`ToolFrame`): the confirmation before it changes
//     production data (`tools.change`), the one before a job runs and the line of a job that runs (`tools.jobs.confirm`,
//     `tools.jobs.running`) and OpenLen's own file picker (`tools.files.pick`) — without them those dialogs would show
//     key paths, and they are exactly the ones that ask before something with consequences. An ordinary app has no bridge
//     and none of those dialogs, so it is not sent them.
// If `ToolFrame` ever reads another subtree, add it to TOOL_DIALOG_KEYS: the window's test fails on a missing message.
export const TOOL_DIALOG_KEYS = ["change", "jobs", "files"] as const;

type WsChrome = { desktop: unknown; tools: Record<string, unknown> };

export async function windowMessages(locale: string, o: { readonly tool: boolean }): Promise<Record<string, unknown>> {
  const { default: wsChrome } = (await import(`@/messages/${locale}/wsChrome.json`)) as { default: WsChrome };
  const tools = o.tool ? { tools: Object.fromEntries(TOOL_DIALOG_KEYS.map((key) => [key, wsChrome.tools[key]])) } : {};
  return { wsChrome: { desktop: wsChrome.desktop, ...tools } };
}
