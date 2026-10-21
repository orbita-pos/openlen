/**
 * Runs only inside the isolated browser. Keep this function closure-free: it is evaluated in the page.
 *
 * Measures every slide of a deck compiled from the slide format (lib/artifacts/adapters/slides/deck.ts) into
 * PowerPoint objects, in CSS paint order: one text box per text block with its runs, shapes with fill, gradient,
 * stroke, corners, shadow, opacity and rotation, a side per strip where border widths differ, tables, lists,
 * images with their object-fit crop, and each <svg> as a picture (that is what it is). Text that does not fit
 * shrinks, box by box and then the whole slide, down to 60 % before it is an error — Claude's "shrink on overflow".
 */
export function measureSlides({ width, height }) {
  const where = (el) => `${el.getAttribute?.("data-len-src") ?? "?"} <${String(el.tagName ?? "?").toLowerCase()}>`;
  const fail = (code, el, what, hint) => { throw new Error(`${code}: ${where(el)}: ${what}${hint ? ` — ${hint}` : ""}`); };
  const TEXT = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "FIGCAPTION"]);
  const INLINE = new Set(["B", "STRONG", "I", "EM", "CITE", "U", "INS", "S", "DEL", "A", "SPAN", "MARK", "SMALL", "LABEL", "TIME", "ABBR", "CODE", "BR"]);
  const LIST = new Set(["UL", "OL"]);
  const px = (v) => parseFloat(v) || 0;
  const color = (value, el, what) => {
    if (!value || value === "transparent") return { hex: "000000", alpha: 0 };
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value);
    if (!m) fail("slide_layout_unsupported", el, `${what}: ${value}`, "write the color as hex or rgb()");
    const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? px(m[4]) / 100 : Number(m[4]);
    return { hex: m.slice(1, 4).map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("").toUpperCase(), alpha };
  };
  const splitTop = (text) => { const out = []; let depth = 0, start = 0; for (let i = 0; i < text.length; i++) { const c = text[i]; if (c === "(") depth++; else if (c === ")") depth--; else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; } } out.push(text.slice(start).trim()); return out; };
  const gradient = (value, el) => {
    if (!value || value === "none") return null;
    const m = /^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/.exec(value.trim());
    if (!m || m[1] || m[3] === "conic" || splitTop(value).length > 1 && !/^(linear|radial)-gradient\(.*\)$/.test(value)) fail("slide_layout_unsupported", el, `background: ${value.slice(0, 120)}`, "one linear-gradient() or radial-gradient(), or a solid color");
    const args = splitTop(m[3]);
    let angle = 180, kind = m[2], at = { x: 50, y: 50 };
    if (kind === "linear" && /^(-?[\d.]+(deg|turn|rad)|to\s)/.test(args[0])) {
      const first = args.shift();
      const sides = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };
      angle = first.startsWith("to") ? sides[first.replace(/\s+/g, " ")] ?? 180 : first.endsWith("turn") ? px(first) * 360 : first.endsWith("rad") ? px(first) * 180 / Math.PI : px(first);
    } else if (kind === "radial" && !/^rgba?\(/.test(args[0])) {
      const shape = args.shift(), pos = /at\s+([\d.]+)%\s+([\d.]+)%/.exec(shape);
      if (pos) at = { x: px(pos[1]), y: px(pos[2]) };
    }
    const stops = args.map((stop) => {
      const c = /^(rgba?\([^)]*\))\s*([\d.]+%)?/.exec(stop);
      if (!c) fail("slide_layout_unsupported", el, `gradient stop: ${stop}`, "colors with optional % positions");
      return { ...color(c[1], el, "gradient"), pos: c[2] === undefined ? null : px(c[2]) };
    });
    stops.forEach((s, i) => { if (s.pos === null) s.pos = stops.length === 1 ? 0 : i === 0 ? 0 : i === stops.length - 1 ? 100 : NaN; });
    for (let i = 1; i < stops.length - 1; i++) if (Number.isNaN(stops[i].pos)) { let j = i; while (Number.isNaN(stops[j].pos)) j++; for (let k = i; k < j; k++) stops[k].pos = stops[i - 1].pos + (stops[j].pos - stops[i - 1].pos) * (k - i + 1) / (j - i + 1); }
    return { kind, angle: ((angle % 360) + 360) % 360, at, stops };
  };
  const shadows = (value, el) => {
    if (!value || value === "none") return [];
    return splitTop(value).slice(0, 2).map((part) => {
      const c = /rgba?\([^)]*\)/.exec(part), rest = part.replace(c?.[0] ?? "", "").trim(), inset = /\binset\b/.test(rest);
      const [x = 0, y = 0, blur = 0, spread = 0] = rest.replace("inset", "").trim().split(/\s+/).map(px);
      return { inset, x, y, blur, spread, ...color(c?.[0] ?? "rgba(0, 0, 0, 1)", el, "shadow") };
    });
  };
  const angleOf = (s, el) => {
    if (s.transform === "none") return 0;
    const m = /^matrix\(([^)]+)\)$/.exec(s.transform);
    if (!m) fail("slide_layout_unsupported", el, `transform: ${s.transform}`, "translate and rotate only");
    const [a, b, c, d] = m[1].split(",").map(Number);
    if (Math.abs(Math.hypot(a, b) - 1) > 0.01 || Math.abs(Math.hypot(c, d) - 1) > 0.01 || Math.abs(a * c + b * d) > 0.01) fail("slide_layout_unsupported", el, "transform: scale or skew", "set width/height or font-size; translate and rotate are supported");
    return Math.round(Math.atan2(b, a) * 180 / Math.PI * 100) / 100;
  };
  const families = new Map();
  const probe = document.createElement("span");
  probe.textContent = "mmmmmmmmmmlliWWQ@#0123";
  probe.style.cssText = "position:absolute;left:-9999px;top:-9999px;font-size:72px;white-space:nowrap;visibility:hidden";
  document.body.appendChild(probe);
  const installed = (family) => {
    if (families.has(family)) return families.get(family);
    let found = false;
    for (const base of ["monospace", "serif", "sans-serif"]) {
      probe.style.fontFamily = base; const w0 = probe.getBoundingClientRect().width;
      probe.style.fontFamily = `"${family}", ${base}`; if (probe.getBoundingClientRect().width !== w0) { found = true; break; }
    }
    families.set(family, found); return found;
  };
  const fontOf = (s) => {
    const list = s.fontFamily.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    for (const f of list) { if (/^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace)$/i.test(f)) return /serif$/i.test(f) && !/sans/i.test(f) ? "Liberation Serif" : /mono/i.test(f) ? "Liberation Mono" : "Liberation Sans"; if (installed(f)) return f; }
    return "Liberation Sans";
  };
  const visible = (el, s) => s.display !== "none" && s.visibility === "visible" && Number(s.opacity) > 0 && !(el.tagName === "ASIDE");
  const backstop = (el, s) => {
    if (s.filter !== "none" || s.backdropFilter !== "none" || s.mixBlendMode !== "normal") fail("slide_layout_unsupported", el, "filter / blend", "use opacity or a painted overlay <div>");
    if (s.clipPath !== "none" || (s.maskImage && s.maskImage !== "none")) fail("slide_layout_unsupported", el, "clip-path / mask", "use border-radius, or draw the shape as an <svg>");
    if (/url\(/.test(s.backgroundImage)) fail("slide_layout_unsupported", el, "background: url()", "a photo is a pinned <img> listed first, behind the rest");
    if (s.webkitBackgroundClip === "text" || s.backgroundClip === "text") fail("slide_layout_unsupported", el, "background-clip: text", "a solid color on the text");
    if (s.writingMode !== "horizontal-tb") fail("slide_layout_unsupported", el, `writing-mode: ${s.writingMode}`, "transform: rotate(-90deg) on the text block");
  };
  const box = (el, s, origin) => {
    const r = el.getBoundingClientRect(), rotate = angleOf(s, el);
    if (!rotate) return { x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height, rotate };
    const w = el.offsetWidth, h = el.offsetHeight;
    return { x: r.x + r.width / 2 - w / 2 - origin.x, y: r.y + r.height / 2 - h / 2 - origin.y, w, h, rotate };
  };
  const radiusOf = (s, b) => { const v = s.borderTopLeftRadius; return Math.min(v.endsWith("%") ? px(v) / 100 * Math.min(b.w, b.h) : px(v), Math.min(b.w, b.h) / 2); };
  const dashOf = (style) => style === "dashed" ? "dash" : style === "dotted" ? "sysDot" : "solid";
  const sidesOf = (el, s) => ["Top", "Right", "Bottom", "Left"].map((side) => ({ side, width: s[`border${side}Style`] === "none" || s[`border${side}Style`] === "hidden" ? 0 : px(s[`border${side}Width`]), style: s[`border${side}Style`], ...color(s[`border${side}Color`], el, "border") }));
  const paintOf = (el, s, b, opacity, id) => {
    const out = [];
    const fill = color(s.backgroundColor, el, "background"), grad = gradient(s.backgroundImage, el), sides = sidesOf(el, s).filter((x) => x.width > 0), shadow = shadows(s.boxShadow, el);
    if (!(fill.alpha > 0 || grad || sides.length || shadow.length)) return out;
    const keyOf = (x) => `${x.style}|${x.hex}|${x.alpha}`;
    if (new Set(sides.map(keyOf)).size > 1) fail("slide_layout_unsupported", el, "borders of different styles or colors", "PowerPoint draws one style and color for every side; a different side is a painted 4px <div>");
    const uniform = sides.length === 4 && new Set(sides.map((x) => x.width)).size === 1;
    const radius = radiusOf(s, b), round = Math.abs(b.w - b.h) < 1 && radius >= b.w / 2 - 0.5;
    out.push({ type: "shape", id, src: el.getAttribute("data-len-src"), ...b, kind: round ? "ellipse" : "rect", radius: round ? 0 : radius, opacity, fill: fill.alpha > 0 ? { color: fill.hex, alpha: fill.alpha } : null, gradient: grad, stroke: uniform ? { color: sides[0].hex, alpha: sides[0].alpha, width: sides[0].width, dash: dashOf(sides[0].style) } : null, shadows: shadow });
    if (!uniform) for (const side of sides) {
      const strip = side.side === "Top" ? { x: b.x, y: b.y, w: b.w, h: side.width } : side.side === "Bottom" ? { x: b.x, y: b.y + b.h - side.width, w: b.w, h: side.width } : side.side === "Left" ? { x: b.x, y: b.y, w: side.width, h: b.h } : { x: b.x + b.w - side.width, y: b.y, w: side.width, h: b.h };
      out.push({ type: "shape", id: `${id}-${side.side.toLowerCase()}`, src: el.getAttribute("data-len-src"), ...strip, rotate: b.rotate, kind: "rect", radius: 0, opacity, fill: side.style === "solid" || side.style === "double" ? { color: side.hex, alpha: side.alpha } : null, gradient: null, stroke: side.style === "dashed" || side.style === "dotted" ? { color: side.hex, alpha: side.alpha, width: side.width, dash: dashOf(side.style) } : null, shadows: [] });
    }
    return out;
  };
  const transformText = (text, t) => t === "uppercase" ? text.toUpperCase() : t === "lowercase" ? text.toLowerCase() : t === "capitalize" ? text.replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase()) : text;
  /** One paragraph per block (and per <li>): its runs, with <br> as a line break inside it. */
  const paragraphOf = (block, el, opacity) => {
    const runs = [];
    const visit = (node, deco, href) => {
      if (node.nodeType === 3) {
        const parent = node.parentElement, s = getComputedStyle(parent);
        let text = node.textContent;
        if (!/^(pre|pre-wrap|break-spaces)$/.test(s.whiteSpace)) text = text.replace(/[\t\n\r ]+/g, " ");
        text = transformText(text, s.textTransform);
        if (!text) return;
        const c = color(s.color, parent, "color"), hl = parent !== block && INLINE.has(parent.tagName) ? color(s.backgroundColor, parent, "background") : { alpha: 0 };
        runs.push({ text, font: fontOf(s), size: px(s.fontSize), bold: Number(s.fontWeight) >= 600 || s.fontWeight === "bold", italic: s.fontStyle !== "normal", underline: deco.underline, strike: deco.strike, color: c.hex, alpha: c.alpha * opacity, letterSpacing: s.letterSpacing === "normal" ? 0 : px(s.letterSpacing), ...(href ? { href } : {}), ...(hl.alpha > 0 ? { highlight: hl.hex } : {}) });
      } else if (node.nodeType === 1) {
        const s = getComputedStyle(node);
        if (s.display === "none") return;
        if (node.tagName === "BR") { runs.push({ text: "", br: true }); return; }
        const line = s.textDecorationLine;
        visit.children(node, { underline: deco.underline || line.includes("underline"), strike: deco.strike || line.includes("line-through") }, node.tagName === "A" ? node.href : href);
      }
    };
    visit.children = (node, deco, href) => { for (const c of node.childNodes) visit(c, deco, href); };
    const s = getComputedStyle(block), line = s.textDecorationLine;
    visit.children(block, { underline: line.includes("underline"), strike: line.includes("line-through") }, block.tagName === "A" ? block.href : null);
    for (let i = 0; i < runs.length; i++) {
      const prev = i ? runs[i - 1] : null;
      if (!prev || prev.br || /\s$/.test(prev.text)) runs[i].text = runs[i].text.replace(/^ +/, "");
    }
    for (let i = runs.length - 1; i >= 0 && !runs[i].br; i--) { runs[i].text = runs[i].text.replace(/ +$/, ""); if (runs[i].text) break; }
    const kept = runs.filter((r) => r.br || r.text);
    const align = { start: "left", left: "left", end: "right", right: "right", center: "center", justify: "justify" }[s.textAlign] ?? "left";
    const shadow = shadows(s.textShadow, el)[0];
    return { align, lineHeight: s.lineHeight === "normal" ? null : px(s.lineHeight), runs: kept, ...(shadow ? { shadow } : {}), ...(px(s.webkitTextStrokeWidth) > 0 ? { outline: { width: px(s.webkitTextStrokeWidth), ...color(s.webkitTextStrokeColor, el, "text stroke") } } : {}) };
  };
  const textExtent = (el, origin) => {
    const range = document.createRange(); range.selectNodeContents(el);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.01 && r.height > 0.01);
    if (!rects.length) return null;
    return { top: Math.min(...rects.map((r) => r.top)) - origin.y, bottom: Math.max(...rects.map((r) => r.bottom)) - origin.y };
  };
  /** Where CSS puts the text: the content box, aligned in it as the block aligns it. */
  const valignOf = (s) => /flex|grid/.test(s.display) ? (s.flexDirection.startsWith("column") ? s.justifyContent : s.alignItems).replace(/^(flex-)?/, "") : "start";
  /** How many lines the browser broke the block's text into. */
  const linesOf = (el) => {
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) if (q.width > 0.01 && q.height > 0.01) rects.push(q); }
    // By the middle of each piece, not its edges: with a tight line-height the letter boxes of two lines overlap.
    rects.sort((a, c) => (a.top + a.bottom) - (c.top + c.bottom));
    let lines = 0, middle = -Infinity, half = 0;
    for (const q of rects) { const m = (q.top + q.bottom) / 2; if (m > middle + half) { lines++; middle = m; half = q.height / 2; } }
    return lines;
  };
  const textItem = (el, s, b, opacity, id, paragraphs) => {
    if (!paragraphs.some((p) => p.runs.some((r) => r.text))) return null;
    const pl = px(s.paddingLeft) + px(s.borderLeftWidth), pr = px(s.paddingRight) + px(s.borderRightWidth), pt = px(s.paddingTop) + px(s.borderTopWidth), pb = px(s.paddingBottom) + px(s.borderBottomWidth);
    // Office measures letters a little wider than Chromium: a line the browser kept whole must not break there,
    // and a block that wraps keeps the browser's width (2 px of rounding) so it breaks where the browser did.
    const wrap = !/^(nowrap|pre)$/.test(s.whiteSpace) && linesOf(el) > 1, v = valignOf(s), valign = v === "center" ? "middle" : v === "end" ? "bottom" : "top";
    if (b.rotate) return { type: "text", id, src: el.getAttribute("data-len-src"), ...b, inset: [pt, pr, pb, pl], valign, wrap, paragraphs, opacity };
    const w = Math.max(b.w - pl - pr, 1);
    return { type: "text", id, src: el.getAttribute("data-len-src"), x: b.x + pl, y: b.y + pt, w: w + (wrap ? 2 : 0), h: Math.max(b.h - pt - pb, 1), rotate: 0, inset: [0, 0, 0, 0], valign, wrap, paragraphs, opacity };
  };
  const isTextBlock = (el) => {
    if (TEXT.has(el.tagName) || INLINE.has(el.tagName)) return true;
    if (LIST.has(el.tagName) || ["IMG", "svg", "SVG", "TABLE", "HR", "SECTION"].includes(el.tagName)) return false;
    const nodes = [...el.childNodes];
    return nodes.some((n) => n.nodeType === 3 && n.textContent.trim()) && nodes.every((n) => n.nodeType !== 1 || INLINE.has(n.tagName));
  };
  const checkClip = (el, s) => {
    if (s.overflow === "visible" || el.tagName === "SECTION") return;
    const r = el.getBoundingClientRect();
    for (const d of el.querySelectorAll("*")) {
      const q = d.getBoundingClientRect(), ds = getComputedStyle(d);
      if (q.width * q.height > 0 && visible(d, ds) && (q.left < r.left - 1 || q.top < r.top - 1 || q.right > r.right + 1 || q.bottom > r.bottom + 1)) fail("slide_layout_unsupported", d, `overflow:${s.overflow} on ${where(el)} clips it`, "PowerPoint cannot clip; keep it inside, or give an <img> its own border-radius");
    }
  };
  /** One slide's objects, in CSS paint order (negative z, flow in tree order, then positioned by z). */
  const measureSlide = (slide) => {
    const section = slide.querySelector(":scope > section"), origin = slide.getBoundingClientRect();
    let serial = 0;
    const next = () => `${slide.dataset.slideId}-${serial++}`;
    const rasters = [];
    const self = (el, s, opacity) => {
      backstop(el, s);
      const b = box(el, s, origin), id = next(), tag = el.tagName.toUpperCase();
      if (tag === "IMG") {
        const fit = s.objectFit === "fill" ? "stretch" : s.objectFit === "cover" ? "cover" : "contain";
        const nw = el.naturalWidth, nh = el.naturalHeight, [ox, oy] = s.objectPosition.split(" ").map((v) => v.endsWith("%") ? px(v) / 100 : 0.5);
        let crop = null, place = { ...b };
        if (fit === "cover" && nw && nh) { const scale = Math.max(b.w / nw, b.h / nh), vw = b.w / scale / nw, vh = b.h / scale / nh; crop = { l: (1 - vw) * ox, t: (1 - vh) * oy, r: (1 - vw) * (1 - ox), b: (1 - vh) * (1 - oy) }; }
        if (fit === "contain" && nw && nh && !b.rotate) { const scale = Math.min(b.w / nw, b.h / nh), w = nw * scale, h = nh * scale; place = { ...b, x: b.x + (b.w - w) * ox, y: b.y + (b.h - h) * oy, w, h }; }
        const sides = sidesOf(el, s).filter((x) => x.width > 0);
        return { items: [{ type: "image", id, src: el.getAttribute("data-len-src"), ...place, assetId: el.getAttribute("data-len-asset"), crop, radius: radiusOf(s, b), round: Math.abs(b.w - b.h) < 1 && radiusOf(s, b) >= b.w / 2 - 0.5, stroke: sides.length ? { color: sides[0].hex, alpha: sides[0].alpha, width: sides[0].width, dash: dashOf(sides[0].style) } : null, shadows: shadows(s.boxShadow, el), opacity }], descend: false };
      }
      if (tag === "SVG") {
        const key = `raster-${id}`; el.setAttribute("data-len-raster-target", key); rasters.push({ id: key, selector: `[data-len-raster-target="${key}"]` });
        const r = el.getBoundingClientRect();
        return { items: [{ type: "image", id, src: el.getAttribute("data-len-src"), x: r.x - origin.x, y: r.y - origin.y, w: r.width, h: r.height, rotate: 0, rasterId: key, crop: null, radius: 0, round: false, stroke: null, shadows: [], opacity }], descend: false };
      }
      if (tag === "TABLE") {
        const items = paintOf(el, s, b, opacity, id), rows = [...el.rows], colW = [...(rows[0]?.cells ?? [])].map((c) => c.getBoundingClientRect().width);
        items.push({ type: "table", id: `${id}-table`, src: el.getAttribute("data-len-src"), x: b.x, y: b.y, w: b.w, h: b.h, rotate: 0, colW, rowH: rows.map((r) => r.getBoundingClientRect().height), opacity, rows: rows.map((row) => [...row.cells].map((cell) => {
          const cs = getComputedStyle(cell), rs = getComputedStyle(row), fill = color(cs.backgroundColor, cell, "background"), rowFill = color(rs.backgroundColor, row, "background");
          const borders = sidesOf(cell, cs).map((x) => x.width > 0 ? { width: x.width, color: x.hex, alpha: x.alpha, dash: dashOf(x.style) } : null);
          return { paragraph: paragraphOf(cell, cell, opacity), valign: cs.verticalAlign === "middle" ? "middle" : cs.verticalAlign === "bottom" ? "bottom" : "top", fill: fill.alpha > 0 ? fill.hex : rowFill.alpha > 0 ? rowFill.hex : null, borders, padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)] };
        })) });
        return { items, descend: false };
      }
      if (LIST.has(tag)) {
        const items = paintOf(el, s, b, opacity, id), lis = [...el.children].filter((li) => li.tagName === "LI" && visible(li, getComputedStyle(li)));
        const paragraphs = lis.map((li, i) => {
          const ls = getComputedStyle(li), type = ls.listStyleType;
          if (color(ls.backgroundColor, li, "background").alpha > 0) fail("slide_layout_unsupported", li, "a painted <li>", "paint the list, or use a <div> per item");
          const nextTop = lis[i + 1]?.getBoundingClientRect().top, bottom = li.getBoundingClientRect().bottom;
          return { ...paragraphOf(li, li, opacity), bullet: type === "none" ? null : type === "decimal" || type === "decimal-leading-zero" ? "number" : "bullet", indent: px(s.paddingLeft), spaceAfter: nextTop === undefined ? 0 : Math.max(0, nextTop - bottom) };
        });
        const pl = px(s.borderLeftWidth), pr = px(s.borderRightWidth) + px(s.paddingRight), pt = px(s.borderTopWidth) + px(s.paddingTop), pb = px(s.borderBottomWidth) + px(s.paddingBottom);
        const wrap = !/^(nowrap|pre)$/.test(s.whiteSpace) && lis.some((li) => linesOf(li) > 1), w = b.w - pl - pr;
        if (paragraphs.some((p) => p.runs.some((r) => r.text))) items.push({ type: "text", id: `${id}-list`, src: el.getAttribute("data-len-src"), x: b.x + pl, y: b.y + pt, w: w + (wrap ? 2 : 0), h: Math.max(b.h - pt - pb, 1), rotate: b.rotate, inset: [0, 0, 0, 0], valign: "top", wrap, paragraphs, opacity });
        return { items, descend: false };
      }
      const items = paintOf(el, s, b, opacity, id);
      if (tag === "HR") return { items, descend: false };
      if (tag !== "SECTION" && isTextBlock(el)) { const t = textItem(el, s, b, opacity, `${id}-text`, [paragraphOf(el, el, opacity)]); if (t) items.push(t); return { items, descend: false }; }
      checkClip(el, s);
      return { items, descend: true };
    };
    const layered = (el, s) => s.position !== "static" || Number(s.opacity) < 1 || s.transform !== "none" || (s.zIndex !== "auto" && /flex|grid/.test(getComputedStyle(el.parentElement).display));
    const zOf = (s) => s.zIndex === "auto" ? 0 : parseInt(s.zIndex, 10) || 0;
    const context = (root, opacity) => {
      const negative = [], flow = [], rest = [];
      let order = 0;
      const walk = (el, op) => {
        for (const child of el.children) {
          const s = getComputedStyle(child);
          if (!visible(child, s)) continue;
          if (layered(child, s)) { (zOf(s) < 0 ? negative : rest).push({ z: zOf(s), order: order++, el: child, s, op }); continue; }
          const own = op * Number(s.opacity), { items, descend } = self(child, s, own);
          flow.push(...items);
          if (descend) walk(child, own);
        }
      };
      walk(root, opacity);
      const group = ({ el, s, op }) => { const own = op * Number(s.opacity), { items, descend } = self(el, s, own); return descend ? [...items, ...context(el, own)] : items; };
      const byZ = (a, b) => a.z - b.z || a.order - b.order;
      return [...negative.sort(byZ).flatMap(group), ...flow, ...rest.sort(byZ).flatMap(group)];
    };
    const ss = getComputedStyle(section);
    backstop(section, ss);
    const bg = color(ss.backgroundColor, section, "background");
    const blend = bg.alpha >= 1 ? bg.hex : [0, 2, 4].map((i) => Math.round(parseInt(bg.hex.slice(i, i + 2), 16) * bg.alpha + 255 * (1 - bg.alpha)).toString(16).padStart(2, "0")).join("").toUpperCase();
    const transition = section.getAttribute("data-transition");
    return { id: slide.dataset.slideId, background: blend, gradient: gradient(ss.backgroundImage, section), transition: transition === "fade" || transition === "push" ? transition : null, elements: context(section, Number(ss.opacity)), rasters };
  };
  /** Text that does not fit: its own box first, then the whole slide, down to 60 % (never below 8px). */
  const fit = (slide) => {
    const blocks = [...slide.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,figcaption,td,th")];
    const scale = (els, factor, saved) => { for (const [el, size, lh] of saved) { el.style.fontSize = `${Math.max(8, size * factor)}px`; if (lh.endsWith("px")) el.style.lineHeight = `${px(lh) * factor}px`; } };
    const snapshot = (root) => [root, ...root.querySelectorAll("*")].map((el) => [el, px(getComputedStyle(el).fontSize), getComputedStyle(el).lineHeight]);
    let shrunk = 1;
    for (const block of blocks) {
      // A tight line-height lets the letters overhang their line box (90 px over 83 at 72px/1.1): that is not
      // text that does not fit. A missing line is at least most of a font size.
      const slack = Math.max(2, 0.35 * px(getComputedStyle(block).fontSize));
      const fits = () => block.scrollHeight <= block.clientHeight + slack && block.scrollWidth <= block.clientWidth + 1;
      if (!block.clientHeight || fits()) continue;
      const saved = snapshot(block);
      let factor = 1; while (!fits() && factor > 0.6) { factor = Math.max(0.6, factor - 0.04); scale(block, factor, saved); }
      if (!fits()) fail("slide_text_overflow", block, "its text does not fit its box even at 60 % of its size", "split the slide or shorten the text");
      shrunk = Math.min(shrunk, factor);
    }
    const origin = slide.getBoundingClientRect();
    const outside = () => blocks.find((el) => { const e = textExtent(el, origin), r = el.getBoundingClientRect(), slack = Math.max(2, 0.35 * px(getComputedStyle(el).fontSize)); return e && (e.bottom > height + slack || r.right - origin.x > width + 1 || e.top < -slack); });
    if (outside()) {
      const saved = snapshot(slide.querySelector(":scope > section"));
      let factor = 1; while (outside() && factor > 0.6) { factor = Math.max(0.6, factor - 0.04); scale(null, factor, saved); }
      const still = outside();
      if (still) fail("slide_text_overflow", still, `its text runs off the ${width}×${height} slide even at 60 % of the slide's text size`, "split the slide or shorten the text");
      shrunk = Math.min(shrunk, factor);
    }
    return shrunk;
  };
  const slides = [...document.querySelectorAll("body > .slide")].map((slide) => { const shrunk = fit(slide); return { ...measureSlide(slide), shrunk: Math.round(shrunk * 100) / 100 }; });
  probe.remove();
  return slides;
}

/** Shared with the browser proof. Never inject Node bindings into a frame. */
export async function captureSlideLayout(page, packet) {
  const slides = await page.evaluate(measureSlides, { width: packet.width, height: packet.height });
  if (slides.length !== packet.pageCount) throw new Error("slide_count_mismatch");
  const assets = [];
  let total = 0, count = 0;
  // A drawing is captured alone, on a transparent page: only it is visible while it is photographed.
  await page.addStyleTag({ content: "html.len-isolate,html.len-isolate body,html.len-isolate .slide{background:transparent!important}html.len-isolate .slide *{visibility:hidden!important}html.len-isolate [data-len-raster-target],html.len-isolate [data-len-raster-target] *{visibility:visible!important}" });
  const drawings = slides.some((s) => s.rasters.length);
  // Twice the pixels for the pictures: CSS layout does not change with the device scale.
  if (drawings) await page.setViewport({ width: packet.width, height: packet.height, deviceScaleFactor: 2 });
  for (const slide of slides) {
    for (const raster of slide.rasters) {
      if (++count > 200) throw new Error("slide_layout_too_large");
      const el = await page.$(raster.selector);
      if (!el || !await el.boundingBox()) throw new Error("slide_layout_unsupported: an <svg> could not be captured");
      await page.evaluate(() => document.documentElement.classList.add("len-isolate"));
      const bytes = await el.screenshot({ type: "png", omitBackground: true });
      await page.evaluate(() => document.documentElement.classList.remove("len-isolate"));
      total += bytes.length;
      if (total > 8 * 1024 * 1024) throw new Error("slide_layout_too_large");
      assets.push({ id: raster.id, mime: "image/png", base64: Buffer.from(bytes).toString("base64") });
    }
    delete slide.rasters;
  }
  if (drawings) await page.setViewport({ width: packet.width, height: packet.height, deviceScaleFactor: 1 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const first = await page.$("body > .slide");
  const png = new Uint8Array(await first.screenshot({ type: "png" }));
  const shrunk = slides.filter((s) => s.shrunk < 1).map((s) => `slides:text-shrunk:${s.id}:${s.shrunk}`);
  return { png, layout: { slides, assets }, checks: ["slides:html-layout-measured", "slides:native-objects", `slides:drawings-as-pictures:${assets.length}`, ...shrunk] };
}
