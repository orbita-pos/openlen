---
name: dataviz
description: Make a chart, a graph, a dashboard's figures or a key number readable and accessible: its form, its colors by the job they do, a palette checked with a script, and a look at the result. Load it before drawing any chart, on a page, in an app, a dashboard, a spreadsheet or a PDF.
---

# Charts

Color comes last. Most charts that read badly chose their colors first.

## The procedure

1. **The form.** Decide what the data has to show: sizes to compare, which thing is which, a change over time, parts of one whole, above or below a midpoint, or one number that matters. That picks the chart: bars to compare sizes (from zero), lines for change over time, a table when the reader looks up exact values. Sometimes it is not a chart: one large number with its change and a sentence says more than a chart of one series.
2. **The color by its job.**
   - Categorical (which series is which): distinct hues in a fixed order.
   - Sequential (how much): one hue, from light to dark.
   - Diverging (above or below a midpoint): two hues with a neutral gray in the middle.
   - Status (good, warning, bad): colors of their own, never reused for a series, always with an icon or a word.

   Take the colors from the project: its accent and the colors already in its CSS, or the `brand` skill when the project has one. Never a palette made up and not checked.
3. **Check the palette with the script** in the terminal; don't judge colors by eye:

   `node <base directory>/scripts/validate_palette.mjs "#0072b2,#e69f00,#009e73" --mode light`

   Give the colors in the order the chart uses them. It answers PASS, WARN or FAIL for each color's lightness and chroma, how far apart neighbors are for normal vision and for protanopia, deuteranopia and tritanopia, and contrast against the chart's background (`--surface <hex>` when it is not white; `--mode dark` for the dark one). Fix every FAIL before drawing: change a color, reorder the series, or show fewer. A WARN on color blindness asks for a second encoding (a direct label, a marker shape, a dashed line); a WARN on contrast asks for labels on those marks or the data as a table. Run it again with the dark mode's own colors.
4. **The marks.** Thin: bars up to about 32 px with a small gap between them, 2 px lines, markers of at least 8 px. Light gridlines, quiet axes, text in the page's text colors and never in a series color. Label directly only what matters (the last point, the largest bar), never every value. Numbers formatted for the user's language (`Intl.NumberFormat`).
5. **Accessibility.** With two series or more there is a legend, and up to four are also labeled at the line or the bar, so no series is told apart only by its color. The data is also there as a table, below the chart or behind a "See data" control. Dark mode gets its own checked colors, not an inversion.
6. **Look at it.** Draw it and look: `view_page` with a screenshot for a page, an app or a dashboard; `Read` with `pages` for a PDF. The script checks colors, not layout: look for labels that collide, a cut axis, a chart overflowing on a phone.

## Fixed rules

- Never two y-axes on one chart. Two measures of different scale go in two charts, or both indexed to a common start (the first month = 100).
- Categorical colors keep their order and are never generated past the palette: a ninth series goes into "Other", or the chart splits into small charts on one scale.
- The color follows the thing, not its position: when a filter hides a series, the others keep their colors.
- No rainbow scales: sequential is one hue, diverging is two plus gray.
- Status colors are only for status.
- No 3D. A pie only when the parts make one whole, and with five slices at most.
- Only real data: ask for it, read it from an attachment or from the project's backend. A chart of made-up numbers is worse than no chart.

Where each chart is drawn (the library, where its data comes from, how to check it) is in references/where.md: read it before choosing the library.
