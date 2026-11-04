# Checking a tool

## In draft

This project's canvas and `view_page` / `use_page` run the real tool with `window.openlen` in draft mode:

- its own backend is the test database;
- it reads the person's real projects, submissions, visits and rows (read-only);
- `update` is always refused with `draft_no_production` — check that the tool says so instead of failing silently.

Check that it loads without errors, that its first screen shows what was asked, and that it reads in light and dark.

## Installed

After the person taps «Instalar», open it with `view_page` / `use_page` and `installed: true`: that is the installed version, as the person sees it. Its writes are always refused there too (`eyes_never_write`).

- Check that it opens (an installation alone doesn't prove the person can open it), that its title and icon are the ones you wrote, and that it reads in light and dark.
- Report what you checked and what you couldn't (for example, a change only the person can confirm).
