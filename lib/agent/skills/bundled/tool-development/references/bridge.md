# window.openlen

OpenLen puts `window.openlen` in the tool before its code runs; its types are in /src/openlen.d.ts. Every method returns a promise. A call that OpenLen refuses rejects with an `Error` whose `message` says why (`owner_only`, `not_found`, `plan_required`, `no_backend`…); show it, don't hide it.

| Method | Returns |
|---|---|
| `context()` | `{ person: { name, locale }, theme: { mode, tokens }, project: { id, title } \| null, tool: { id, version }, environment: "draft" \| "installed" }` |
| `onContext(callback)` | Calls `callback` with a new context when the person switches light/dark or the theme changes. Returns a function that stops it. |
| `backend()` | `{ url, key, session }` for this tool's own backend, signed in as the person. |
| `projects()` | `[{ id, title, role }]` — the projects the person can open; `role` is `dueno`, `editor` or `lector`. |
| `forms(projectId, { since?, until? })` | That project's form submissions (dates as `YYYY-MM-DD`). Only for projects the person owns. |
| `visits(projectId, { from?, to? })` | That project's visits. Only for projects the person owns. |
| `query(projectId, sql)` | Rows of that project's production database. `SELECT` only. Only for projects the person owns. |
| `update(projectId, { table, key, set, before })` | Changes one production row after the person confirms it in OpenLen (see `data.md`). |
| `sendPrompt(text)` | `{ status: "placed" }` puts the text in the person's chat with you, for them to send; `"unavailable"` in the rail. |
| `jobs.run(name, { input?, files? })`, `jobs.get`, `jobs.list`, `jobs.cancel`, `jobs.follow` | A job in OpenLen's box, after the person confirms its cost (see `jobs.md`). |
| `files.pick({ accept?, multiple? })`, `files.deliver({ name, contentType, bytes })` | OpenLen's own file picker, and a file the tool hands the person (see `jobs.md`). |

## The theme

Paint with the workspace's colours so the tool looks like part of OpenLen. `context().theme.tokens` has CSS values for `--bg`, `--bg-elev`, `--fg`, `--fg-muted`, `--fg-faint`, `--border`, `--border-strong`, `--hover`, `--accent`, `--accent-strong`, `--accent-soft`, `--accent-ring`, `--link` and `--font-sans`; `mode` is `light` or `dark`. Set them on the root and follow changes:

```tsx
function applyTheme(theme: OpenLenToolContext["theme"]) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(name, value);
  root.classList.toggle("dark", theme.mode === "dark");
}
window.openlen.context().then((c) => applyTheme(c.theme));
window.openlen.onContext((c) => applyTheme(c.theme));
```

Then use `var(--bg)`, `var(--fg)`, `var(--accent)`… in classes or styles. Literal colours are for artwork only.

## The backend

/src/lib/supabase.ts already exports `supabase` (supabase-js) and `signedIn`, a promise that resolves once `backend()`'s session is set. Await it before the first query:

```tsx
import { signedIn, supabase } from "./lib/supabase";
await signedIn;
const { data, error } = await supabase.from("notes").select("*");
```
