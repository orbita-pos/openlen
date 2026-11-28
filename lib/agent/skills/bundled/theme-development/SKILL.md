---
name: theme-development
description: Use before making, changing, installing or applying a workspace theme in this project — the scene for one window and its twin for the other, the glass, the manifest and display record, what the scene's gate refuses, how to look at it with the preview page, and how publish and set_theme finish the job.
---

# Making a workspace theme

This project is a theme for the person's own OpenLen, not a website. A theme is what sits behind their workspace: a **scene** (an animated SVG) under **glass** panels — the rail, your chat panel, the top bar — or, without a scene, a still **ground**, a **palette** or a **font**. The client's page in the canvas is never themed: it stays opaque, because the page is what gets judged. Only the person who installs it sees it.

The project is born with a working pair you replace: `/themes/scene.svg` (light) and `/themes/scene-night.svg` (dark), declared in `/package.json`, titled in `/locale/*.json`, and shown by the preview page (`/index.html`, also at `/themes/preview.html`).

## The method

1. **One scene for one kind of window, and its twin for the other.** Every theme says which window it is drawn for (`"window": "light"` or `"dark"`). Draw the light one, then the same picture for the dark window, and name each other with `twin`. The workspace shows the one that matches the person's setting; without a twin it switches the window to the theme's kind while the theme is on.
2. **The still picture is a finished drawing.** With reduced motion every animation stops, and a slow machine shows the scene still. What is left when nothing moves must already be a composed, complete picture — never a blank waiting for its animation.
3. **Motion is slow and sparse.** It has to sit under hours of work: cycles of tens of seconds, a handful of things moving, nothing that flashes, nothing that pulls the eye from the text. Animate only with CSS `@keyframes` inside the scene's `<style>`.
4. **Keep the interesting parts at the edges.** The middle of the window is under panels and text; detail there is wasted and fights legibility.
5. **The glass as low as still reads.** Start transparent and raise `opacity` only until the text is easy to read over the busiest part of the scene. Installing measures what lies under your panel and raises the opacity if the text wouldn't reach 4.5:1 — and says so; it never refuses. A theme whose glass had to be raised a lot wants a calmer scene there, not more glass.
6. **Look at it** (below), the light theme and the dark one, fix what you saw, and only then install.
7. **Install with `publish`, apply with `set_theme`.**

## The manifest — `/package.json`

The themes are the list under `openlen.theme.themes`:

```json
{
  "openlen": {
    "theme": {
      "themes": [
        { "id": "pond", "window": "light", "twin": "pond-night", "scene": "/themes/pond.svg",
          "glass": { "blur": 10, "opacity": 0.4, "tint": "#eef8f1" } },
        { "id": "pond-night", "window": "dark", "twin": "pond", "scene": "/themes/pond-night.svg",
          "glass": { "blur": 10, "opacity": 0.45, "tint": "#0c1a14" } }
      ]
    }
  }
}
```

- `id`: lowercase letters, digits, `-` or `_`, starting with a letter or digit; unique in the project. Up to 64 themes.
- `twin`: another theme of this project, of the other window.
- `scene`: an absolute path to an `.svg` in the project.
- `glass`: `blur` in points from 0 to 64, `opacity` from 0 to 1, `tint` a raw colour (`#hex`, `rgb()`, `rgba()`, `hsl()`, `hsla()` of plain numbers). Left out, a scene gets `{ blur: 16, opacity: 0.6 }`; `false` means no glass. Glass is only for a scene.
- Without a scene, a theme can be a still `ground` — exactly one of:
  - `{ "color": "#f3efe6" }`
  - `{ "gradient": { "stops": ["#0b1020", { "color": "#24324f", "at": 0.7 }], "angle": 180, "shape": "linear", "size": [64, 64], "repeat": true } }` — 2 to 16 stops; `at` from 0 to 1, in order; `angle` in degrees (-360 to 360); `shape` `linear` or `radial`.
  - `{ "vector": { "viewBox": 24, "paths": ["M0 0H12V12H0Z", { "d": "M12 12h12v12H12Z", "color": "#d8cfbd", "strokeWidth": 1 }], "color": "#e9e2d2", "size": [24, 24], "repeat": true } }` — `viewBox` a square's side or `[width, height]`, 1 to 256; 1 to 64 paths, each whole path data, with a colour of its own or the vector's.
  - `size` is always `[width, height]` in points, each 1 to 256. A picture (`image`) is refused: redraw it as SVG.
- `colors`: a palette over the workspace's own tokens, raw colours only — `--bg`, `--bg-sidebar`, `--bg-preview`, `--bg-elev`, `--fg`, `--fg-muted`, `--fg-faint`, `--border`, `--border-strong`, `--accent`, `--accent-soft`, `--hover`. Any other name is refused.
- `font`: one of `sans`, `serif`, `mono`, `code`, `cursive`.

A theme is any one of a scene, a ground, a palette or a font (or several of them, but never a scene and a ground together).

## The display record — `/locale/<lang>.json`

```json
{ "themes": { "pond": { "title": "Pond", "blurb": "Lily pads drift on still green water." },
              "pond-night": { "title": "Pond, Night", "blurb": "The same pond under the moon." } } }
```

Every theme needs a title (≤ 60 characters) and a blurb (≤ 200) in English and in the person's language. Write them properly: the skeleton's are placeholders.

## The scene — `/themes/*.svg`

- The root is `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">` — a `viewBox`, and a `preserveAspectRatio` that slices, so it covers any window.
- All motion is CSS in the scene's own `<style>`, and it ends with `@media (prefers-reduced-motion: reduce){*{animation:none!important}}`. If you forget that rule, installing adds it (the answer says `addedReducedMotion: true`) — write it yourself anyway.
- Give every `id` a hyphen (`sky-fade`, `k-deep`): an id that is also a name the browser knows (`open`, `clear`) can vanish in some hosts, and with it the gradient or mask that used it. No such name has a hyphen.
- Keep it light: what the install counts is elements and what animates them. A scene the answer marks `heavy` (`cost.heavy: true`) is shown still on slower machines; lighten it — fewer animated elements, fewer elements overall — before you call it done.

The gate refuses a scene for any of these; the code comes back from `publish`:

- `script` — a `<script>` anywhere; a scene never runs code.
- `event_handler` — an `on…=` attribute such as `onload`.
- `foreign_object` — a `<foreignObject>`; draw everything in SVG.
- `external_ref` — an `href`, `url()`, `@import` or `src` that points outside the file; only `#id` references inside it.
- `doctype` — a `<!DOCTYPE>`, `<!ENTITY>` or other DTD declaration; leave it out.
- `too_big` — over 1 MB.
- `no_viewbox` — the root has no usable `viewBox` (four numbers, positive width and height).
- `not_slice` — the root's `preserveAspectRatio` isn't a `… slice` value.
- `not_svg` — the root isn't `<svg>` in the SVG namespace.
- `smil` — `<animate>`, `<set>`, `<animateTransform>`, `<animateMotion>` or `<discard>`; animate with CSS `@keyframes` instead.
- `char_reference` — a numeric character reference (`&#…;`); type the character itself.
- `css_escape` — a backslash in a style; write the plain text.
- `foreign_namespace` — an `xmlns` other than SVG's and XLink's.
- `style_markup` — markup or a comment inside `<style>`; keep the CSS plain.

## Look at it

The preview paints each theme's scene behind a fake workspace — a rail, a chat panel with text in the three inks, a white page — with the glass made the way the workspace makes it, one stage per theme, light and dark side by side. It is this project's page, `/index.html`, and the same page is kept at `/themes/preview.html`. Look at it with `view_page` `mode="screenshot"` (no `file_path`: it is the page) and read the screenshot: does every line of text read over the scene, in the light stage and in the dark one? Is the still picture finished? `mode="measure"` on it gives the contrast numbers.

🔴 The glass numbers are written TWICE: in `/package.json` and in the `style` of each `<section class="stage">` of the preview (`--blur`, `--opacity`, `--tint`, in `/index.html` and its copy `/themes/preview.html`). When you change a glass, or add, rename or remove a theme (each stage names its scene), change both, or the preview shows something that isn't what installs.

## Install and apply

- **`publish`** installs every theme of this project for the person, at once and privately: nothing goes on the web. It answers with each theme's `ref`, its `cost`, the `glassOpacity` it will be painted with (higher than yours when it had to be raised), whether the reduced-motion rule was added, and `contrastWarnings` (`glass_unmeasured`: the measuring couldn't run, so check the preview yourself; `glass_below_target`: even the raised glass doesn't reach 4.5:1 — calm the scene under the panels). With problems it installs nothing and lists them with their codes: fix them and call it again. Only the project's owner installs it.
- **`set_theme`** applies one for whoever is talking to you: `{ "theme": "<ref>", "scope": "everywhere" }` for all their OpenLen, or `"project"` for just this one. `"off"` clears that scope. It also takes the gallery's themes (`bundled:honu-lagoon`). After installing, apply the one they asked for, unless they said not to.

## Examples

`references/` has three scenes from Claude Code's `theme-examples` to read, not to copy wholesale:

- `honu-lagoon.svg` — light window, glass `{ blur: 7, tint: "#e6fbff", opacity: 0.42 }`: an ASCII lagoon seen from above, a turtle swimming by an island. Light: it is not heavy.
- `night-reef.svg` — dark window, glass `{ blur: 14, tint: "#0a1430", opacity: 0.4 }`: the same lagoon after dark. It is `heavy` by the install's count — an example of a scene that wants lightening.
- `paper-garden.svg` — light window, glass `{ blur: 16, tint: "#fbf6ec", opacity: 0.5 }`: cut-paper leaves at the edges of a warm sheet, one coral bloom — detail at the edges, a quiet middle.

Read one with `Read` when you need to see how its `<style>`, its slow keyframes and its reduced-motion rule are written.
