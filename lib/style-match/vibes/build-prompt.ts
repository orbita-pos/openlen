import type { VibeBrief } from "./types";

// System prompt for Kimi K2.6 when applying a vibe to user HTML. Modeled on
// the existing /api/templates/ai-design route's protocol — emit ID-tagged ops
// via <edits>…</edits>. Reuses lib/html-ops.ts to apply.
//
// We deliberately tell the model: this is a RESTYLE, not a rewrite. Keep
// copy + structure. Transform visual styling only (colors, type rhythm,
// spacing density, shadows, radius, signature elements per the brief).

export const VIBE_APPLY_SYSTEM_PROMPT = `You are restyling a landing page's HTML to match a specific design vibe. The user has a working page; you transform its visual feel without changing its content.

PROTOCOL
You emit an <edits>...</edits> block containing 1 to 32 <edit> operations addressing elements by their data-op-id attribute. Operations are:

<edit op="replace" target="<id>"><new>...new HTML for this element...</new></edit>
<edit op="insert_before" target="<id>"><new>...</new></edit>
<edit op="insert_after" target="<id>"><new>...</new></edit>
<edit op="delete" target="<id>" />

You may also emit one global stylesheet op at the start using a special meta element pattern by replacing the document <head> children block or appending a <style> tag inside head. Prefer global stylesheet injection for the bulk of vibe restyling (color variables, typography rhythm, shadow vocabulary), then use targeted per-element replace ops for SIGNATURE ELEMENTS that need structural changes (e.g., hero becomes centered, sections alternate bg, gradient seams added between sections).

RULES
1. ONLY address elements by their existing data-op-id. Do NOT invent IDs.
2. NEVER include data-op-id in the new HTML you emit — the server strips IDs after apply.
3. NEVER include data-slot-path anywhere — that marker is reserved for editor mode.
4. Cap at 32 ops total per response. Be precise; one well-placed stylesheet beats 20 small ops.
5. Preserve all visible copy text exactly. Preserve all <img> src attributes. Preserve link href targets.
6. You MAY rewrite class lists, inline styles, structural wrappers, and add/remove decorative elements (separator divs, signature accents).
7. DO NOT change the document title or the main content sections' meaning — only their visual presentation.
8. Inject Google Fonts <link> tags inside <head> when the vibe brief requires a specific font.
9. The injected <style> block should use !important on overrides because the source page often has utility classes; do NOT use !important on color values inside ops — only inside the injected stylesheet.
10. When done, emit </edits>. Nothing after it.

QUALITY BAR
Your output should make a designer say "yes, that's actually [vibe name]" — not "that's a color swap of the original". Apply typography rhythm + spacing density + shadow vocabulary + signature elements from the brief, not just colors.`;

export interface BuildVibePromptInput {
  vibe: VibeBrief;
  taggedHtml: string;
  /** Optional user free-form note ("make it a bit warmer", "use serif"). */
  userNote?: string;
}

export interface KimiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function buildVibePromptMessages(input: BuildVibePromptInput): KimiMessage[] {
  const { vibe, taggedHtml, userNote } = input;

  const userMessage = `Apply the following vibe to the user's HTML.

═══════════════════════════════════════════
VIBE: ${vibe.name}
${vibe.tagline}
═══════════════════════════════════════════

${vibe.brief}

═══════════════════════════════════════════
USER'S CURRENT HTML (every interesting element has a data-op-id attribute):
═══════════════════════════════════════════

${taggedHtml}

═══════════════════════════════════════════
${userNote ? `EXTRA USER NOTE: ${userNote}\n\n═══════════════════════════════════════════\n` : ""}Emit your <edits>...</edits> response now. Use ID-tagged ops to restyle the page so it genuinely feels like ${vibe.name} (${vibe.inspiration} family). Inject a Google Fonts <link> for the typography family in the brief. Inject a global <style> block in <head> with the color variables, typography overrides, spacing scale, shadow vocabulary, and radius — using !important on overrides since the source HTML has utility classes. Then add per-element replace ops for the SIGNATURE ELEMENTS that need structural changes (hero alignment, section gradient seams, alternating backgrounds, etc.). Cap at 32 ops total. Preserve every word of copy.`;

  return [
    { role: "system", content: VIBE_APPLY_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
}
