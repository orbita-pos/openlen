# openlen-terminal — the real terminal's E2B template

Spec (local): `docs/superpowers/specs/2026-10-21-real-terminal-e2b-design.md`.

What the box has: Ubuntu 24.04, Node 22, Python 3 with pip, git, ripgrep, jq, sqlite3, curl, unzip,
and OpenLen's scripts in `/opt/openlen/bin` (generated from `lib/agent/sandbox/template-files.ts`):

- `openlen-manifest`: path → sha256 of the project's files, as JSON.
- `openlen-bridge`: the commands OpenLen answers (`git`, `supabase`, `tsc`, `eslint`, `vitest`,
  `npm`, `npx`, `curl`), through the mailbox in `/run/openlen`.
- one wrapper per bridged program. The turn puts `/opt/openlen/bin` first in `PATH`.

Size: 2 vCPU and 4 GiB (`lib/agent/sandbox/size.ts`), fixed at build.

Build (needs the `e2b` package and `E2B_API_KEY`; costs E2B build time):

```bash
npm run sandbox:template
```

A changed template gets a NEW name in `SANDBOX_TEMPLATE` (`lib/agent/sandbox/config.ts`), so boxes
already paused keep the one they were born with.
