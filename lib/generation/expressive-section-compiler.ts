import {
  SectionDecisionProvenanceSchema,
  validateExpressiveSectionProgram,
  type ExpressiveNode,
  type ExpressiveSectionProgram,
  type SectionDecisionProvenance,
} from "./expressive-section-contracts";
import { canonicalJsonSha256, sha256 } from "./content-hash";

const SPACE_CLASS = Object.freeze({ none: "olx-space-none", xs: "olx-space-xs", sm: "olx-space-sm", md: "olx-space-md", lg: "olx-space-lg", xl: "olx-space-xl", "2xl": "olx-space-2xl" });
const WIDTH_CLASS = Object.freeze({ narrow: "olx-width-narrow", content: "olx-width-content", wide: "olx-width-wide", full: "olx-width-full" });
const ALIGN_CLASS = Object.freeze({ start: "olx-align-start", center: "olx-align-center", end: "olx-align-end", stretch: "olx-align-stretch" });
const JUSTIFY_CLASS = Object.freeze({ start: "olx-justify-start", center: "olx-justify-center", end: "olx-justify-end", between: "olx-justify-between" });
const COLUMN_CLASS = Object.freeze({ one: "olx-columns-one", two: "olx-columns-two", three: "olx-columns-three", four: "olx-columns-four", asymmetric_left: "olx-columns-asymmetric-left", asymmetric_right: "olx-columns-asymmetric-right" });
const COLOR_CLASS = Object.freeze({ background: "olx-color-background", surface: "olx-color-surface", surface_alt: "olx-color-surface-alt", ink: "olx-color-ink", muted: "olx-color-muted", accent: "olx-color-accent", accent_ink: "olx-color-accent-ink", line: "olx-color-line" });
const RADIUS_CLASS = Object.freeze({ none: "olx-radius-none", sm: "olx-radius-sm", md: "olx-radius-md", lg: "olx-radius-lg", pill: "olx-radius-pill", organic: "olx-radius-organic" });
const BORDER_CLASS = Object.freeze({ none: "olx-border-none", hairline: "olx-border-hairline", strong: "olx-border-strong", dashed: "olx-border-dashed" });
const TRANSFORM_CLASS = Object.freeze({ none: "olx-transform-none", tilt_left: "olx-transform-tilt-left", tilt_right: "olx-transform-tilt-right", lift: "olx-transform-lift", sink: "olx-transform-sink", scale_up: "olx-transform-scale-up" });
const BLEND_CLASS = Object.freeze({ normal: "olx-blend-normal", multiply: "olx-blend-multiply", screen: "olx-blend-screen", overlay: "olx-blend-overlay" });
const SIZE_CLASS = Object.freeze({ xs: "olx-size-xs", sm: "olx-size-sm", md: "olx-size-md", lg: "olx-size-lg", xl: "olx-size-xl", "2xl": "olx-size-2xl", display: "olx-size-display" });

const OWNED_CSS = [
  ".olx-layout{position:relative;box-sizing:border-box;isolation:isolate;min-width:0}",
  ".olx-layout-stack{display:flex;flex-direction:column}.olx-layout-flex{display:flex;flex-wrap:wrap}.olx-layout-grid,.olx-layout-bento{display:grid}.olx-layout-split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,.85fr)}",
  ".olx-layout-collage{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));align-items:center}.olx-layout-collage>*:nth-child(odd){grid-column:span 7}.olx-layout-collage>*:nth-child(even){grid-column:span 5}",
  ".olx-layout-bento>*:first-child{grid-column:span 2}.olx-layout-layered{display:grid}.olx-layout-layered>*{grid-area:1/1}",
  ".olx-space-none{gap:0;padding:0}.olx-space-xs{gap:.35rem;padding:.35rem}.olx-space-sm{gap:.75rem;padding:.75rem}.olx-space-md{gap:1.25rem;padding:1.25rem}.olx-space-lg{gap:2rem;padding:2rem}.olx-space-xl{gap:3rem;padding:3rem}.olx-space-2xl{gap:5rem;padding:5rem}",
  ".olx-width-narrow{max-width:44rem;margin-inline:auto}.olx-width-content{max-width:68rem;margin-inline:auto}.olx-width-wide{max-width:88rem;margin-inline:auto}.olx-width-full{width:100%}",
  ".olx-align-start{align-items:flex-start}.olx-align-center{align-items:center}.olx-align-end{align-items:flex-end}.olx-align-stretch{align-items:stretch}",
  ".olx-justify-start{justify-content:flex-start}.olx-justify-center{justify-content:center}.olx-justify-end{justify-content:flex-end}.olx-justify-between{justify-content:space-between}",
  ".olx-columns-one{grid-template-columns:minmax(0,1fr)}.olx-columns-two{grid-template-columns:repeat(2,minmax(0,1fr))}.olx-columns-three{grid-template-columns:repeat(3,minmax(0,1fr))}.olx-columns-four{grid-template-columns:repeat(4,minmax(0,1fr))}.olx-columns-asymmetric-left{grid-template-columns:minmax(0,1.35fr) minmax(0,.65fr)}.olx-columns-asymmetric-right{grid-template-columns:minmax(0,.65fr) minmax(0,1.35fr)}",
  ".olx-color-background{background:var(--bg);color:var(--ink)}.olx-color-surface{background:var(--surface);color:var(--ink)}.olx-color-surface-alt{background:var(--surface-2,var(--surface));color:var(--ink)}.olx-color-ink{color:var(--ink)}.olx-color-muted{color:var(--muted)}.olx-color-accent{background:var(--accent);color:var(--accent-ink)}.olx-color-accent-ink{color:var(--accent-ink)}.olx-color-line{color:var(--line)}",
  ".olx-radius-none{border-radius:0}.olx-radius-sm{border-radius:.4rem}.olx-radius-md{border-radius:.8rem}.olx-radius-lg{border-radius:1.4rem}.olx-radius-pill{border-radius:999px}.olx-radius-organic{border-radius:42% 58% 48% 52%/58% 44% 56% 42%}",
  ".olx-border-none{border:0}.olx-border-hairline{border:1px solid var(--line)}.olx-border-strong{border:3px solid var(--line)}.olx-border-dashed{border:2px dashed var(--line)}",
  ".olx-transform-none{transform:none}.olx-transform-tilt-left{transform:rotate(-2deg)}.olx-transform-tilt-right{transform:rotate(2deg)}.olx-transform-lift{transform:translateY(-.4rem)}.olx-transform-sink{transform:translateY(.4rem)}.olx-transform-scale-up{transform:scale(1.025)}",
  ".olx-blend-normal{mix-blend-mode:normal}.olx-blend-multiply{mix-blend-mode:multiply}.olx-blend-screen{mix-blend-mode:screen}.olx-blend-overlay{mix-blend-mode:overlay}",
  ".olx-copy{position:relative;z-index:2;margin:0;max-width:32ch}.olx-copy.olx-tone-default{font-weight:500;letter-spacing:0}.olx-copy.olx-tone-quiet{font-weight:400;letter-spacing:.02em;opacity:.72}.olx-copy.olx-tone-strong{font-weight:900;letter-spacing:-.01em}.olx-copy.olx-tone-accent{font-weight:700;color:var(--accent);text-decoration:underline;text-decoration-thickness:.12em;text-underline-offset:.14em}.olx-copy.olx-tone-inverse{font-weight:600;background:var(--ink);color:var(--bg);padding:.12em .25em}.olx-heading{font-family:var(--font-display);font-weight:800;line-height:.95;letter-spacing:-.035em}.olx-body,.olx-quote{font-family:var(--font-body);line-height:1.55}.olx-quote{font-style:italic}.olx-stat{font-family:var(--font-display);font-weight:800}.olx-badge{display:inline-flex;width:max-content;padding:.35rem .7rem;border:1px solid currentColor;border-radius:999px}.olx-action{display:inline-flex;width:max-content;padding:.75rem 1rem;text-decoration:none;border:0;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:inherit}",
  ".olx-size-xs{font-size:.72rem}.olx-size-sm{font-size:.875rem}.olx-size-md{font-size:1rem}.olx-size-lg{font-size:1.25rem}.olx-size-xl{font-size:1.75rem}.olx-size-2xl{font-size:clamp(2rem,5vw,4rem)}.olx-size-display{font-size:clamp(3rem,9vw,8rem)}",
  ".olx-media{position:relative;z-index:1;min-height:12rem;background:var(--surface-2,var(--surface));overflow:hidden}.olx-aspect-square{aspect-ratio:1}.olx-aspect-portrait{aspect-ratio:3/4}.olx-aspect-landscape{aspect-ratio:4/3}.olx-aspect-cinematic{aspect-ratio:16/9}.olx-aspect-auto{min-height:16rem}.olx-fit-cover{background-size:cover}.olx-fit-contain{background-size:contain}.olx-media-framed{border:1px solid var(--line);padding:.65rem}.olx-media-bleed{border-radius:0}.olx-media-cutout{clip-path:polygon(6% 0,100% 8%,94% 100%,0 92%)}.olx-media-film{filter:grayscale(.75) contrast(1.25);border:6px solid var(--ink)}.olx-media-paper{filter:saturate(.85);border:2px dashed var(--line)}",
  ".olx-decoration{pointer-events:none;user-select:none;z-index:0}.olx-decoration-shape{position:absolute;width:clamp(3rem,12vw,10rem)}.olx-decoration-divider{position:relative;width:100%;align-self:stretch}.olx-decoration-texture{position:absolute;inset:0}.olx-decoration.olx-size-xs{width:2rem}.olx-decoration.olx-size-sm{width:3rem}.olx-decoration.olx-size-md{width:4rem}.olx-decoration.olx-size-lg{width:6rem}.olx-decoration.olx-size-xl{width:8rem}.olx-decoration.olx-size-2xl{width:10rem}.olx-decoration.olx-size-display{width:14rem}.olx-shape-circle{aspect-ratio:1;border-radius:50%;background:currentColor}.olx-shape-square{aspect-ratio:1;background:currentColor}.olx-shape-blob{aspect-ratio:1;border-radius:42% 58% 61% 39%;background:currentColor}.olx-shape-star{aspect-ratio:1;background:currentColor;clip-path:polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 94%,50% 72%,21% 94%,32% 57%,2% 35%,39% 35%)}.olx-shape-line{height:2px;width:100%;background:currentColor}.olx-shape-grain{min-height:8rem;background:radial-gradient(circle,currentColor 0 1px,transparent 1px);background-size:5px 5px}.olx-shape-dots{min-height:8rem;background:radial-gradient(circle,currentColor 0 2px,transparent 2px);background-size:18px 18px}.olx-shape-stripes{min-height:8rem;background:repeating-linear-gradient(45deg,currentColor 0 2px,transparent 2px 12px)}.olx-opacity-faint{opacity:.12}.olx-opacity-soft{opacity:.35}.olx-opacity-solid{opacity:.8}",
  "@keyframes olx-fade-up{from{opacity:0;transform:translateY(1rem)}to{opacity:1;transform:none}}@keyframes olx-reveal{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0)}}@keyframes olx-drift{50%{transform:translate3d(.5rem,-.35rem,0)}}@keyframes olx-pulse{50%{opacity:.65}}@keyframes olx-marquee{to{transform:translateX(-8%)}}@keyframes olx-stagger{from{opacity:0}to{opacity:1}}",
  ".olx-motion-fade-up{animation:olx-fade-up .7s ease both}.olx-motion-reveal{animation:olx-reveal .8s ease both}.olx-motion-drift{animation:olx-drift 5s ease-in-out infinite}.olx-motion-pulse{animation:olx-pulse 2.8s ease-in-out infinite}.olx-motion-marquee{animation:olx-marquee 5s linear infinite}.olx-motion-stagger{animation:olx-stagger .9s steps(4,end) both}.olx-intensity-subtle{animation-duration:1.2s}.olx-intensity-medium{animation-duration:.8s}.olx-intensity-bold{animation-duration:.45s}.olx-delay-none{animation-delay:0s}.olx-delay-short{animation-delay:.12s}.olx-delay-medium{animation-delay:.3s}.olx-delay-long{animation-delay:.55s}",
  "@media(max-width:900px){.olx-columns-four{grid-template-columns:repeat(2,minmax(0,1fr))}.olx-space-2xl{gap:3rem;padding:3rem}}",
  "@media(prefers-reduced-motion:reduce){[class*='olx-motion-']{animation:none!important;transition:none!important;transform:none!important}}",
].join("");

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

function rootTag(role: ExpressiveSectionProgram["role"]): "nav" | "header" | "section" | "footer" {
  if (role === "header") return "nav";
  if (role === "hero") return "header";
  if (role === "footer") return "footer";
  return "section";
}

function shortHash(value: string): string {
  return sha256(value).replace(/^sha256:/, "").slice(0, 12);
}

function structuralNode(node: ExpressiveNode, indexes: ReadonlyMap<string, number>): unknown {
  if (node.kind === "layout") return {
    kind: node.kind, preset: node.preset, gap: node.gap, padding: node.padding, width: node.width, align: node.align,
    justify: node.justify, columns: node.columns, color: node.color, radius: node.radius, border: node.border,
    transform: node.transform, blend: node.blend, children: node.children.map((child) => structuralNode(child, indexes)),
  };
  if (node.kind === "copy") return { kind: node.kind, variant: node.variant, tone: node.tone, size: node.size, color: node.color, align: node.align, keyCount: "copyKeys" in node ? node.copyKeys.length : 1, destination: "destination" in node ? node.destination : undefined };
  if (node.kind === "media") return { kind: node.kind, aspect: node.aspect, fit: node.fit, treatment: node.treatment, radius: node.radius, transform: node.transform, hasAlt: node.altCopyKey !== undefined };
  return { kind: node.kind, decoration: node.decoration, shape: node.shape, color: node.color, size: node.size, transform: node.transform, blend: node.blend, opacity: node.opacity };
}

function programNode(node: ExpressiveNode): unknown {
  if (node.kind === "layout") return {
    kind: node.kind, preset: node.preset, gap: node.gap, padding: node.padding, width: node.width, align: node.align,
    justify: node.justify, columns: node.columns, color: node.color, radius: node.radius, border: node.border,
    transform: node.transform, blend: node.blend, children: node.children.map(programNode),
  };
  if (node.kind === "copy") return {
    kind: node.kind, variant: node.variant, tone: node.tone, size: node.size, color: node.color, align: node.align,
    ...(node.variant === "list" ? { copyKeys: node.copyKeys } : { copyKey: node.copyKey, ...(node.variant === "action" ? { destination: node.destination } : {}) }),
  };
  if (node.kind === "media") return {
    kind: node.kind, slotIndex: node.slotIndex, aspect: node.aspect, fit: node.fit, treatment: node.treatment,
    radius: node.radius, transform: node.transform, ...(node.altCopyKey ? { altCopyKey: node.altCopyKey } : {}),
  };
  return { kind: node.kind, decoration: node.decoration, shape: node.shape, color: node.color, size: node.size, transform: node.transform, blend: node.blend, opacity: node.opacity };
}

function canonicalProgramHash(program: ExpressiveSectionProgram, indexes: ReadonlyMap<string, number>): string {
  return canonicalJsonSha256({
    schemaVersion: program.schemaVersion,
    role: program.role,
    root: programNode(program.root),
    responsive: { mobile: program.responsive.mobile.map((row) => ({ ...row, nodeId: indexes.get(row.nodeId) })) },
    motion: program.motion.map((row) => ({ ...row, nodeId: indexes.get(row.nodeId) })),
  });
}

function collectIndexes(node: ExpressiveNode, indexes = new Map<string, number>()): Map<string, number> {
  indexes.set(node.id, indexes.size);
  if (node.kind === "layout") node.children.forEach((child) => collectIndexes(child, indexes));
  return indexes;
}

function structuralFingerprint(program: ExpressiveSectionProgram, indexes: ReadonlyMap<string, number>): string {
  return canonicalJsonSha256({
    root: structuralNode(program.root as ExpressiveNode, indexes),
    responsive: program.responsive.mobile.map((row) => ({ ...row, nodeId: indexes.get(row.nodeId) })),
    motion: program.motion.map((row) => ({ ...row, nodeId: indexes.get(row.nodeId) })),
  });
}

function layoutClasses(node: Extract<ExpressiveNode, { kind: "layout" }>, index: number): string {
  return [
    "olx-layout", `olx-layout-${node.preset}`, `olx-node-${index}`, SPACE_CLASS[node.gap], WIDTH_CLASS[node.width], ALIGN_CLASS[node.align],
    JUSTIFY_CLASS[node.justify], COLUMN_CLASS[node.columns], COLOR_CLASS[node.color], RADIUS_CLASS[node.radius], BORDER_CLASS[node.border],
    TRANSFORM_CLASS[node.transform], BLEND_CLASS[node.blend],
  ].join(" ");
}

function renderCopy(node: Extract<ExpressiveNode, { kind: "copy" }>, index: number, copy: Readonly<Record<string, string>>, motion: string): string {
  const classes = `olx-copy olx-${node.variant} olx-node-${index} olx-tone-${node.tone} ${SIZE_CLASS[node.size]} ${COLOR_CLASS[node.color]} olx-text-${node.align}${motion}`;
  if (node.variant === "list") return `<ul class="${classes}">${node.copyKeys.map((key) => `<li>${escapeHtml(copy[key] ?? "")}</li>`).join("")}</ul>`;
  const value = escapeHtml(copy[node.copyKey] ?? "");
  if (node.variant === "action") {
    return `<a class="${classes}" href="#openlen-${node.destination}">${value}</a>`;
  }
  const tag = node.variant === "heading" ? "h2" : node.variant === "body" ? "p" : node.variant === "quote" ? "blockquote" : node.variant === "badge" ? "span" : "strong";
  return `<${tag} class="${classes}">${value}</${tag}>`;
}

function renderNode(
  node: ExpressiveNode,
  indexes: ReadonlyMap<string, number>,
  motions: ReadonlyMap<string, string>,
  copy: Readonly<Record<string, string>>,
): string {
  const index = indexes.get(node.id)!;
  const motion = motions.get(node.id) ?? "";
  if (node.kind === "layout") return `<div class="${layoutClasses(node, index)}${motion}">${node.children.map((child) => renderNode(child, indexes, motions, copy)).join("")}</div>`;
  if (node.kind === "copy") return renderCopy(node, index, copy, motion);
  if (node.kind === "media") {
    const alt = node.altCopyKey ? escapeHtml(copy[node.altCopyKey] ?? "") : "";
    const accessibility = alt ? ` role="img" aria-label="${alt}"` : ' aria-hidden="true"';
    return `<div class="olx-media olx-node-${index} olx-aspect-${node.aspect} olx-fit-${node.fit} olx-media-${node.treatment} ${RADIUS_CLASS[node.radius]} ${TRANSFORM_CLASS[node.transform]}${motion}" data-openlen-asset-slot="${node.slotIndex}"${accessibility}></div>`;
  }
  return `<div class="olx-decoration olx-decoration-${node.decoration} olx-node-${index} olx-shape-${node.shape} ${COLOR_CLASS[node.color]} ${SIZE_CLASS[node.size]} ${TRANSFORM_CLASS[node.transform]} ${BLEND_CLASS[node.blend]} olx-opacity-${node.opacity}${motion}" aria-hidden="true"></div>`;
}

function responsiveCss(program: ExpressiveSectionProgram, indexes: ReadonlyMap<string, number>, id: string): string {
  const rules = program.responsive.mobile.map((override) => {
    const selector = `[data-sec="${id}"] .olx-node-${indexes.get(override.nodeId)}`;
    if (override.hidden) return `${selector}{display:none!important}`;
    const display = override.preset === "stack" || override.preset === "flex" ? "flex" : "grid";
    const direction = override.preset === "stack" ? ";flex-direction:column" : "";
    const columns = COLUMN_CLASS[override.columns].replace("olx-columns-", "");
    const columnValue = columns === "one" ? "minmax(0,1fr)" : columns === "two" ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)";
    const space = ({ none: "0", xs: ".35rem", sm: ".75rem", md: "1.25rem", lg: "2rem", xl: "3rem", "2xl": "5rem" } as const)[override.gap];
    const padding = ({ none: "0", xs: ".35rem", sm: ".75rem", md: "1.25rem", lg: "2rem", xl: "3rem", "2xl": "5rem" } as const)[override.padding];
    return `${selector}{display:${display}${direction};grid-template-columns:${columnValue};gap:${space};padding:${padding}}`;
  }).join("");
  return `@media(max-width:640px){${rules}}`;
}

export interface ExpressiveSectionDraft {
  readonly id: string;
  readonly html: string;
  readonly role: ExpressiveSectionProgram["role"];
  readonly rootTag: "nav" | "header" | "section" | "footer";
  readonly programHash: string;
  readonly structuralFingerprint: string;
  readonly contentHash: string;
  readonly provenance: SectionDecisionProvenance;
}

export interface CompileExpressiveSectionSuccess {
  readonly ok: true;
  readonly draft: ExpressiveSectionDraft;
}

export type CompileExpressiveSectionResult = CompileExpressiveSectionSuccess | {
  readonly ok: false;
  readonly code: "invalid_program" | "copy_key_not_allowed" | "asset_slot_not_allowed" | "invalid_provenance" | "donor_reconstruction";
};

export function compileExpressiveSection(input: {
  program: ExpressiveSectionProgram;
  allowedCopyKeys: readonly string[];
  allowedAssetSlots: readonly number[];
  provenance: SectionDecisionProvenance;
  copy?: Readonly<Record<string, string>>;
}): CompileExpressiveSectionResult {
  const provenance = SectionDecisionProvenanceSchema.safeParse(input.provenance);
  if (!provenance.success || provenance.data.action === "reuse") return { ok: false, code: "invalid_provenance" };
  const validated = validateExpressiveSectionProgram(input.program, {
    allowedCopyKeys: input.allowedCopyKeys,
    allowedAssetSlots: input.allowedAssetSlots,
  });
  if (!validated.ok) return validated;
  const program = validated.program;
  const indexes = collectIndexes(program.root as ExpressiveNode);
  const programHash = canonicalProgramHash(program, indexes);
  const fingerprint = structuralFingerprint(program, indexes);
  const id = `expressive-${program.role}-${programHash.replace(/^sha256:/, "").slice(0, 12)}`;
  const motionClasses = new Map(program.motion.map((motion) => [motion.nodeId,
    ` olx-motion-${motion.preset} olx-intensity-${motion.intensity} olx-delay-${motion.delay}`,
  ]));
  const tag = rootTag(program.role);
  const body = renderNode(program.root as ExpressiveNode, indexes, motionClasses, input.copy ?? {});
  const html = `<style data-openlen-expressive="expressive-section-program/1.0">[data-sec="${id}"]{display:block;position:relative;overflow:hidden;background:var(--bg);color:var(--ink)}${OWNED_CSS}${responsiveCss(program, indexes, id)}</style><${tag} data-sec="${id}" data-openlen-generated="expressive-section-program/1.0">${body}</${tag}>`;
  const contentHash = shortHash(html);
  if (provenance.data.action === "rebuild"
    && (provenance.data.sourceStructuralFingerprint === fingerprint || provenance.data.sourceContentHash === contentHash)) {
    return { ok: false, code: "donor_reconstruction" };
  }
  return {
    ok: true,
    draft: {
      id, html, role: program.role, rootTag: tag, programHash,
      structuralFingerprint: fingerprint, contentHash, provenance: provenance.data,
    },
  };
}
