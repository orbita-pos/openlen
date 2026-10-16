/**
 * THE MANUAL THAT `read_me` RETURNS (local spec 2026-10-16-len-inline-visuals, §4.2).
 *
 * Same structure as the manual of Claude's visualize tools — a common part and
 * one guide per module, asked for on demand — in our own words: the repo is
 * public and none of Anthropic's prose is copied (checked by
 * plans/len-visuals/copy-check.mjs). It speaks of OpenLen's chat, its colors
 * (the workspace tokens) and its frame (`lib/visuals/frame-document.ts`).
 */
import { VISUAL_MODULES, type VisualModule } from "./widget";

export type VisualPlatform = "mobile" | "desktop" | "unknown";

/** The CSS variables the frame defines, light and dark. The frame
 *  (`lib/visuals/frame-document.ts`) gives each one a default and the chat sends
 *  the workspace's resolved values; the manual names them for the model. */
export const VISUAL_TOKENS: readonly { readonly name: string; readonly role: string }[] = [
  { name: "--bg", role: "the chat behind the visual; you rarely need it, the frame is already transparent over it" },
  { name: "--bg-elev", role: "a raised surface: cards, tiles, metric boxes" },
  { name: "--fg", role: "main text and values" },
  { name: "--fg-muted", role: "secondary text: labels, legends, captions" },
  { name: "--fg-faint", role: "the quietest text: axis ticks, hints, metadata" },
  { name: "--border", role: "hairline borders and gridlines" },
  { name: "--border-strong", role: "a border that must stand out, or a hovered one" },
  { name: "--accent", role: "OpenLen's accent: links, the selected option, the one series that matters" },
  { name: "--accent-soft", role: "a light tint of the accent, as a background" },
  { name: "--accent-strong", role: "accent-colored text on --accent-soft" },
  { name: "--hover", role: "the background of a hovered row or button" },
  { name: "--success", role: "good news (always with a word or an icon, never color alone)" },
  { name: "--warning", role: "something to watch" },
  { name: "--danger", role: "something wrong" },
  { name: "--series-1", role: "first chart series" },
  { name: "--series-2", role: "second chart series" },
  { name: "--series-3", role: "third chart series" },
  { name: "--series-4", role: "fourth chart series" },
  { name: "--series-5", role: "fifth chart series" },
  { name: "--series-6", role: "sixth chart series; fold anything beyond six into one called «Other»" },
  { name: "--radius", role: "the corner radius of controls and cards" },
  { name: "--font-sans", role: "the chat's typeface" },
  { name: "--font-mono", role: "code and tabular figures, when you need them" },
];

const CDNS = [
  "https://cdnjs.cloudflare.com",
  "https://esm.sh",
  "https://cdn.jsdelivr.net",
  "https://unpkg.com",
];

function width(platform: VisualPlatform): string {
  return platform === "mobile"
    ? "The person is on a phone: you have about 360px of width."
    : "You have the width of the chat column, about 420px; on a phone it drops to about 360px, so nothing may need more than that.";
}

function common(platform: VisualPlatform): string {
  return `# Visuals in OpenLen's chat

A visual lives inside your reply, between the words you write before and after the show_widget call. The person should feel it is part of OpenLen's chat, not a page pasted into it: transparent background (the chat shows through), flat surfaces, no shadows, no gradients, no glow.

## The words carry the explanation
Say what matters in your reply. The visual only shows: no headings, no paragraphs, no "here is your chart" inside it. Where the chat can't draw (a thread, an email, a voice call) your reply is all the person gets, so it must make sense on its own.

## Write in the order it is shown
The visual appears while you write it. Start with a short <style> (a few rules), then the content, and put every <script> at the very end: scripts only run once you have finished. Prefer inline style="" for things that must look right halfway through. Comments waste time while it is being shown: leave them out.

## Size
${width(platform)} Design for that width: no horizontal overflow, no inner scrollbars, columns that wrap (grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) and minmax(0, 1fr) for a single column). The frame measures your content and grows to fit it, so never use position: fixed and never try fullscreen: an overlay or a modal mockup goes inside a normal block with its own height.

## Colors
Use only these variables, with var(--name), so the visual follows the person's light or dark theme without you doing anything. A hex written by hand stays the same in dark mode and can become unreadable.
${VISUAL_TOKENS.map((t) => `- ${t.name}: ${t.role}`).join("\n")}
A <canvas> can't read CSS variables: read them first with getComputedStyle(document.documentElement).getPropertyValue("--fg") and pass the values to the chart.

## Type
Text 14px, labels 12–13px, nothing under 11px. Two weights: 400 and 500. Sentence case everywhere. Headings, if any, stay small (16–18px).

## Icons
The Lucide icon font is already loaded: <i class="icon-<lucide-name>" aria-hidden="true"></i> (for example icon-chart-column, icon-arrow-up-right, icon-check), 16 to 24px with font-size. Don't draw icons by hand and don't use emoji.

## Libraries and network
Scripts, styles and fetch() reach only ${CDNS.join(", ")}; fonts only https://fonts.googleapis.com (stylesheets) and https://fonts.gstatic.com (font files). Anything else is blocked and fails without a message. Load a library with a classic <script src> (its UMD build) before the inline <script> that uses it. Images: data: URLs or files on those CDNs.

## Numbers and data
Every figure comes from your tools (results, files, the inbox) — never estimate one or make one up, and your words and the visual must say the same thing. Round every number you show (Math.round, toFixed, Intl.NumberFormat): counts as integers, percentages with at most one decimal.

## Accessibility
An HTML visual starts with <h2 class="sr-only"> and one sentence that says what it shows. Every <canvas> has role="img", an aria-label with the gist and the numbers as fallback text inside it. Every control has a name a screen reader can say.

## Talking to the chat
- sendPrompt(text) sends text to you as a message from the person. It only works as the answer to their click, once per click. Use it for a next step that needs you to think ("Compare with last month"); filtering, sorting and recalculating happen in the visual's own JavaScript.
- Links (<a href="https://…">) and openLink(url) ask the person to confirm, then open in a new tab. The visual never navigates.

## Don't
No <!doctype>, <html>, <head> or <body>: a fragment. No hidden sections while you write (tabs and steppers only after the scripts run). No forms that send anywhere. No password or payment fields.`;
}

const MODULE_GUIDES: Readonly<Record<VisualModule, string>> = {
  chart: `## chart
Pick the shape from the question before picking colors. One current number, maybe with its change: a metric box (label 12px in --fg-muted, value 24px weight 500), not a chart. A few headline numbers: a row of metric boxes. Change over days or weeks: a line (an area for a single series). Comparing amounts: bars. Part of a whole: one stacked bar.
Color by job. One series: --accent. Several: --series-1, --series-2… always in that order, so the same thing keeps the same color when you filter. When one series is the story, give it --accent and the rest --fg-faint.
Keep the chrome quiet: gridlines in --border and only horizontal ones when the x axis is time, axis text in --fg-faint, and never two y axes in the same chart. Bars at most 24px thick; lines 2px.
Chart.js: load the UMD build from https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js, wrap the <canvas> in a <div> with position: relative and a fixed height, set responsive: true and maintainAspectRatio: false, hide the built-in legend and write your own in HTML (a small square of the series color next to a label in --fg-muted, with the value). Give each canvas its own id.`,
  diagram: `## diagram
For a flow, a structure or how something works. Use one <svg width="100%" viewBox="0 0 W H" role="img"> with <title> and <desc> first; set W to the width you have and H to just below the last element. Boxes: <rect> with fill var(--bg-elev), stroke var(--border-strong), stroke-width 0.5 to 1, rx 6. Text: 13px in var(--fg), 12px in var(--fg-muted), centered with text-anchor="middle" and dominant-baseline="central". SVG text never wraps: if a label doesn't fit, shorten it. Arrows: lines or paths with fill="none" and stroke var(--fg-faint), stopping at the edge of the box, never crossing another box or label. At most four or five boxes; if there are more, show the overview first and the detail in a second visual with a sentence between them. Use --accent only for the part the person asked about.`,
  mockup: `## mockup
For a card, a screen, a list, a comparison of options. Cards: background var(--bg-elev), border 1px solid var(--border), border-radius calc(var(--radius) * 1.5), padding 12–16px. Lists: rows separated by a --border line, not a card each. Options side by side in a grid that wraps; mark the recommended one with a 2px --accent border and a small label (background --accent-soft, text --accent-strong). Buttons, inputs and selects already have the chat's style: write the bare elements.`,
  interactive: `## interactive
For a small tool the person can play with: a slider that recalculates, buttons that switch a view, a calculator. Do the work in the visual's own JavaScript: it runs on every change without calling you. Show the result next to the control that changed it, rounded. Check what the person typed before using it and show a short message next to the field if it's empty or wrong. Use sendPrompt only for what needs you to think, and make it clear on the button (end its label with ↗).`,
};

export function buildVisualsManual(modules: readonly VisualModule[], platform: VisualPlatform): string {
  const asked = VISUAL_MODULES.filter((m) => modules.includes(m));
  return [common(platform), ...asked.map((m) => MODULE_GUIDES[m])].join("\n\n");
}
