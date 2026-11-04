# The display record

The Herramientas page, the rail and the install card show it. Complete it before installing; `publish` refuses a tool without it.

- **Title** — `meta.title` in `/locale/en.json` and in `/locale/<the person's language>.json` (and any other language you add). Recognizable, at most 60 characters, sentence case: «Today's bookings», not «Today's Bookings».
- **Description** — `meta.description` in the same files: one line saying what it does, at most 200 characters.
- **Icon** — `/icon.svg` (or a PNG, JPEG or WebP exported as `./icon`), at most 256 KiB, inside the project, never a URL. Draw an original one that says what the tool is; the icon the tool was born with is a placeholder and is refused. Simple shapes in `currentColor` read well in light and dark.
- `/package.json` keeps `"exports": { "./locale/*.json": "./locale/*.json", "./icon": "./icon.svg" }` — change the icon's path there if you change the file.
- Don't leave text from the skeleton in it: everything describes this tool.
