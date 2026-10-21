export const slidesManual = `# Slide deck deliverables

A deck is files in /.len/artifacts/<id>/: an index and one file per slide. It exports as a web page, an editable PowerPoint (every text box, shape, table and picture is a real PowerPoint object) and a PDF.

## The files
deck.json is the index: {"version":3,"title":"Turnia","order":["cover","problem","plan"],"sections":{"s1":{"description":"Why and how much","start":"cover"}}}. order lists slide ids in deck order (letters, digits, - and _). sections is optional: your outline, each a one-line description and the id of the slide it starts at. A slide file the order leaves out shows last.
slides/<id>.html is exactly one <section id="<id>" style="…"> and nothing around it: no <html>, <head>, <body>, <style>, <link> or <script>. The section's id is the file's name. Speaker notes are plain text in one <aside>, the section's last child, 4000 characters at most; write them only when the user asks for notes or a script.
The canvas is 1920×1080 px. When the user says a size in points, a point is two pixels (36pt = 72px). Saving a slide answers at once with what is outside the format, anchored to its line, in <new-diagnostics>; fix those before render_artifact.

## The format
Every style is inline in style="". There is no stylesheet, so class does nothing and is refused; values you repeat can be CSS variables declared on the <section> (--accent:#f59e0b; then color:var(--accent)).
Layout is ordinary CSS and the browser resolves it: flex, grid, gap, padding, margin, width/height, min/max, position (relative/absolute), z-index, calc(), em and %. Use padding:128px on the section for the margins (1664×824 inside).
What becomes a PowerPoint object is a closed list:
- Text blocks: <h1> <h2> <h3> <p>, and a <div> holding only text. Inside them only <b> <i> <u> <s> <a href="https://…"> <span style="color/background…"> <br>. Each block is one text box with its runs. Defaults: h1 96px, h2 64px, h3 44px, p 32px; nothing under 24px.
- Text styles: font-family, font-size, font-weight, font-style, line-height, letter-spacing, text-align, text-transform, text-decoration (underline, line-through), white-space, color, text-shadow, -webkit-text-stroke. A <span> background is a highlight.
- Lists: <ul> or <ol> of plain <li> (one level). Bullets and numbers stay real PowerPoint bullets.
- Tables: <table> of <tr> with <th>/<td> holding text; a <tr> or cell may have a background; width:N% on the first row's cells sets the columns. No colspan/rowspan.
- Painted boxes: any <div> (or text block) with background (a color, one linear-gradient() or one radial-gradient()), border, border-radius, box-shadow, opacity, transform: translate()/rotate().
- Borders: one style and one color per element; the sides may have different widths (border-bottom alone is a rule). For an accent bar or a side of another color, place a painted 4px <div>.
- Corners: one border-radius for every corner; 50% on a square is a circle, a large radius is a pill.
- Pictures: <img src="asset:<artifactId>@<revision>/<output>" alt="…" style="width;height;object-fit:cover|contain"> from a saved output (inspect_artifact gives the exact assetId; naming it is the dependency, also in a correction). object-position, border-radius, border and box-shadow carry over. No URLs, no data:.
- Drawings: an inline <svg aria-label="what it shows"> (52 KB at most, no <script>, on*=, <foreignObject> or URLs) becomes one picture. Keep its words outside it, as <p> text over or beside it: fonts do not load inside an svg.
- Transitions: data-transition="fade" or "push" on the <section>.
Not available, and what to do instead: filter, backdrop-filter, mix-blend-mode → opacity or a painted overlay <div>; clip-path, mask → border-radius or an <svg>; background-image: url() → a pinned <img> listed first; background-clip: text → a solid color; scale/skew → set the size; overflow:hidden that cuts a child → keep the child inside, or give an <img> its own border-radius; <button> → a <p> pill; <canvas> → <svg>. Usual HTML names are read as their equivalent and noted (<strong> as <b>, <em> as <i>, <header>/<footer>/<figure> as <div>, <h4>–<h6> as <h3>).
Paint order is CSS's: positioned elements (position:relative/absolute, or with z-index) paint over the static ones, then by z-index. For a full-bleed photo behind a slide: the <img> first with position:absolute;inset:0;width:1920px;height:1080px;object-fit:cover, and position:relative on the content that goes over it.
Text that does not fit its box shrinks, box by box and then the whole slide, down to 60 %; the export's evidence says which slides shrank. A shrunken slide is a slide to split.
Fonts in the renderer: Inter, Roboto, Open Sans, Lato, EB Garamond, Calibri, Cambria, Arial, Times New Roman, Courier New, JetBrains Mono, DejaVu Sans (any other falls back to a generic). Calibri, Cambria, Arial and Times New Roman look the same on every computer with Office; the others are kept by name.

## Designing the deck
Be a presentation designer, not a web designer: a slide is a 1920×1080 poster read from the back of a room.
- Start from the story: who it is for and the one decision or feeling it leads to. Write the slide titles first, in one grammar (short topics, or short statements), so the titles alone tell the story; share them in a line.
- One idea per slide. Prefer a statement, a big number with its label, a table, a row of cards, a picture or a chart over bullets; never paragraphs on a slide.
- Choose once and repeat: one dark and one light tone plus one or two accents (hex, toned rather than pure #fff/#000), 1–3 typefaces, a scale of four or five sizes. Emphasize with weight or color, not a new size. Text keeps 4.5:1 contrast (3:1 from 44px).
- Content slides share their markup and keep the heading at the same top position; spread the body with justify-content:space-between or a flex:1 spacer instead of centering the whole column. Statement, quote and closing slides may center.
- Budget the height: 824px inside the margins. A line takes about font-size × line-height; a word needs about 0.6 × font-size per character of width. Too much: split the slide.
- A footer (source, page, logo) is one 24px line pinned at bottom:64px; give that slide padding-bottom:160px.
- Charts: bars as <div>s on one baseline (fixed-height track, align-items:flex-end) stay editable shapes; an <svg> is a picture. Labels and values as <p>.
- Use the project's real name, facts and screens; write [placeholders] for numbers the user did not give and list them; never invent a statistic or a quote. Pictures come from the user, saved images or screenshots; do not draw decoration or use emoji.
- Avoid the generated look: a gradient on every slide, emoji, rounded cards with a colored left border on every card, dramatic "It's not X, it's Y" titles.
- A small correction changes only the slides named, keeping every id and the rest of the deck as it is.

## Older descriptor decks (version 1)
Decks saved earlier as a deck.json of positioned elements ({"version":1,"width":1280,…,"slides":[{"id":"cover","elements":[…]}]}) still export. Correct them in the same format; write new decks in version 3.`;
