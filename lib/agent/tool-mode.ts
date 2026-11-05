// LEN'S TOOL POSTURE (spec local 2026-11-04-herramientas-hechas-por-len, §4.8): a project born as a tool is an app
// (the app posture stays: `modo-app.ts`), plus what makes it a tool — it installs into the person's OpenLen
// instead of being published, it carries DeepSeek's display record, it talks to OpenLen through `window.openlen`,
// and Len's eyes can open the installed version. The details live in the `tool-development` skill, loaded when
// needed, as DeepSeek's Creator does with its plugin skill.
//
// Cache effect: in tool projects only, the system prompt gains one section and three declarations change
// (`publish`, `view_page`, `use_page`); page and app prompts and declarations stay byte-identical.

export const TOOL_POSTURE_CHANGES = ["publish", "view_page", "use_page"] as const;

const TOOL_POSTURE = `TOOL POSTURE
This project is a TOOL: an app that installs into the person's own OpenLen, not a site for visitors. Once installed it shows up where its /package.json says ("openlen.tool.placement": "rail" for its own icon in the side rail, "project" for a lens inside each project the person opens). It talks to OpenLen only through window.openlen (types in /src/openlen.d.ts): its own backend, the person's projects, form submissions, visits and read-only SQL, a production change that OpenLen asks the person to confirm, and heavy work run as a job in OpenLen's box after the person confirms what it costs, with files they pick in OpenLen's own picker. Before building or changing it, load the tool-development skill: it says where things go, the display record (title, description and an icon of its own in /locale and /icon.svg), and how to check it. In this project's canvas and in your eyes it runs in draft mode, on its test database. With installed: true your eyes open the installed version, whose own data is the person's real data: change it there only when the person asked. To install it, call publish: it shows the person an «Instalar» card, and nothing is installed until they tap it. Then open it with installed: true to check it in its real place.`;

/** Phase 4 (spec local 2026-11-04-herramientas-hechas-por-len, §4.6, §4.7): what the posture says of the tool's
 *  operations, by whether this server runs Edge Functions (the same for every turn of the server: the cache holds). */
const OPERATIONS_ON = `Its operations for you — what it does to its own data — are an MCP server in one of its Edge Functions (references/functions.md): once installed, you get them in every project of the person as mcp__<serverName>__<operation>, and the screen calls the same logic.`;
const OPERATIONS_OFF = `Edge Functions don't run on this server yet, so the tool can't have operations for you: its screen hands you text with sendPrompt.`;

export function promptOfTool(appPrompt: string, o: { readonly functions?: boolean } = {}): string {
  return `${appPrompt}\n\n${TOOL_POSTURE} ${o.functions ? OPERATIONS_ON : OPERATIONS_OFF}`;
}

const TOOL_MANUAL = `## Tool

This project is a tool made by Len (it installs into the person's OpenLen; it isn't published).

- /package.json — "openlen": { "tool": { "placement": "rail" | "project" } }, and "exports" for "./locale/*.json" and "./icon".
- /locale/<language>.json — { "meta": { "title", "description" } } in English and in the person's language.
- /icon.svg — the tool's own icon (SVG, PNG, JPEG or WebP, at most 256 KiB). The one it was born with is a placeholder and is refused.
- /src/openlen.d.ts — the types of window.openlen, the bridge to OpenLen.
- /src/lib/supabase.ts — the tool's backend client, signed in as the person through window.openlen.backend().`;

export function manualOfTool(appManual: string): string {
  return `${appManual}\n\n${TOOL_MANUAL}`;
}

const INSTALL_DESCRIPTION =
  "Install this tool into the person's OpenLen. Shows the person a card; nothing is installed until they tap it. Returns problems with the manifest, the code or the security review first.";

const INSTALLED_PARAM = {
  type: "BOOLEAN",
  description:
    "Open the installed version, in its real place, instead of the draft. Its own data there is the person's real data: what you do in it changes that data, so only when the person asked. update, which changes another project's production, is refused.",
};

const DARK_PARAM = {
  type: "BOOLEAN",
  description: "Show it with OpenLen's dark colours, as the person sees it in dark mode, instead of light.",
};

function withInstalled(d: Record<string, unknown>): Record<string, unknown> {
  const parameters = (d.parameters ?? { type: "OBJECT", properties: {} }) as { type: string; properties?: Record<string, unknown>; required?: string[] };
  return { ...d, parameters: { ...parameters, properties: { ...(parameters.properties ?? {}), installed: INSTALLED_PARAM, dark: DARK_PARAM } } };
}

export function declarationsOfTool(declarations: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return declarations.map((d) => {
    if (d.name === "publish") return { name: "publish", description: INSTALL_DESCRIPTION, parameters: { type: "OBJECT", properties: {} } };
    if (d.name === "view_page" || d.name === "use_page") return withInstalled(d);
    return d;
  });
}
