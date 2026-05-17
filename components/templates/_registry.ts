// Curated template registry — file-based (pure HTML, no TSX components).
//
// Each entry pairs a static .html file in /public/templates/curated/ with
// the metadata the workspace surfaces (name, pitch, family, accent, mode).
// Picking a template clones its HTML into a new project's `data.html` via
// /api/projects/from-template; the workspace then opens that project and
// the user can publish it to their own subdomain.
//
// The templates themselves NEVER live at a subdomain — they're inspiration
// material. Only user projects get subdomains, at publish time.

export type TemplateFamily =
  | "technical-minimal"
  | "editorial"
  | "commerce";

export type TemplateMode = "dark" | "light" | "cream";

export interface TemplateEntry {
  id: string;
  name: string;
  pitch: string;
  family: TemplateFamily;
  /** Brand accent — surfaced in the card chrome for visual identity. */
  accent: string;
  /** Visual mode the template runs in. Used only for chrome hints (the
   *  HTML file itself is the canonical source of truth for styling). */
  mode: TemplateMode;
  /** Filename within /public/templates/curated/. Serves directly via Next's
   *  static handler at /templates/curated/<fileName>. */
  fileName: string;
  /** SEO description used as a fallback when claiming the project title. */
  description: string;
}

export const TEMPLATE_FAMILY_META: Record<
  TemplateFamily,
  { label: string; tagline: string }
> = {
  "technical-minimal": {
    label: "Technical Minimal",
    tagline:
      "Dark, mono accents, terminal mockups. For devtools and infra.",
  },
  editorial: {
    label: "Editorial",
    tagline:
      "Serif headlines, numbered sections, magazine rhythm. For premium and craft brands.",
  },
  commerce: {
    label: "Commerce",
    tagline:
      "Modern retail tech, payment flows, product mockups. For POS and marketplace.",
  },
};

export const TEMPLATES: TemplateEntry[] = [
  // ── Technical Minimal (dark, devtools) ────────────────────────────────────
  {
    id: "mirror",
    name: "Mirror",
    pitch: "Catch your AI breaking the rules before your users do.",
    family: "technical-minimal",
    accent: "#3ECF8E",
    mode: "dark",
    fileName: "mirror.html",
    description: "Runtime guardrails for LLM applications.",
  },
  {
    id: "anchor",
    name: "Anchor",
    pitch: "Branch your Postgres like Git.",
    family: "technical-minimal",
    accent: "#5E6AD2",
    mode: "dark",
    fileName: "anchor.html",
    description: "Database branching for staging environments.",
  },
  {
    id: "pulse",
    name: "Pulse",
    pitch: "See the bug. Not the stack trace.",
    family: "technical-minimal",
    accent: "#E5407B",
    mode: "dark",
    fileName: "pulse.html",
    description: "Real-time error tracking with session replay.",
  },
  {
    id: "compass",
    name: "Compass",
    pitch: "See every hop in your cluster.",
    family: "technical-minimal",
    accent: "#00D4D4",
    mode: "dark",
    fileName: "compass.html",
    description: "Service mesh observability for Kubernetes.",
  },
  {
    id: "kiln",
    name: "Kiln",
    pitch: "Build only what changed. Cache like you mean it.",
    family: "technical-minimal",
    accent: "#F5C26B",
    mode: "dark",
    fileName: "kiln.html",
    description: "CI/CD platform built for monorepos.",
  },

  // ── Editorial (magazine-feel, serif) ─────────────────────────────────────
  {
    id: "foundry",
    name: "Foundry",
    pitch: "Engineering, written like it matters.",
    family: "editorial",
    accent: "#F97316",
    mode: "dark",
    fileName: "foundry.html",
    description: "Long-form magazine for engineering culture.",
  },
  {
    id: "manuscript",
    name: "Manuscript",
    pitch: "Where readers actually read.",
    family: "editorial",
    accent: "#B36A3A",
    mode: "light",
    fileName: "manuscript.html",
    description: "Newsletter platform for serious writers.",
  },
  {
    id: "aperture",
    name: "Aperture",
    pitch: "Your work, in its proper proportions.",
    family: "editorial",
    accent: "#C8A88A",
    mode: "dark",
    fileName: "aperture.html",
    description: "Photography portfolio publishing platform.",
  },
  {
    id: "quill",
    name: "Quill",
    pitch: "The essays your team should actually read.",
    family: "editorial",
    accent: "#4F8259",
    mode: "cream",
    fileName: "quill.html",
    description: "Tech essays and thought leadership.",
  },
  {
    id: "loom",
    name: "Loom",
    pitch: "Read with your ears. Properly.",
    family: "editorial",
    accent: "#C8A8E0",
    mode: "dark",
    fileName: "loom.html",
    description: "Audio essays for people who'd rather listen than scroll.",
  },

  // ── Commerce / Point of Sale / Marketplaces ──────────────────────────────
  {
    id: "counter",
    name: "Counter",
    pitch: "The POS that thinks like a barista.",
    family: "commerce",
    accent: "#C66B3D",
    mode: "cream",
    fileName: "counter.html",
    description: "Modern POS for independent coffee shops.",
  },
  {
    id: "mantle",
    name: "Mantle",
    pitch: "One source of inventory truth.",
    family: "commerce",
    accent: "#0E1A3A",
    mode: "light",
    fileName: "mantle.html",
    description: "Inventory + fulfillment OS for DTC brands.",
  },
  {
    id: "tessera",
    name: "Tessera",
    pitch: "Faster tables. Bigger checks. Calmer staff.",
    family: "commerce",
    accent: "#B05030",
    mode: "cream",
    fileName: "tessera.html",
    description: "Restaurant POS with QR ordering.",
  },
  {
    id: "trove",
    name: "Trove",
    pitch: "Where things made by hand find people who care.",
    family: "commerce",
    accent: "#7CA982",
    mode: "cream",
    fileName: "trove.html",
    description: "Marketplace platform for makers of handmade goods.",
  },
  {
    id: "receipts",
    name: "Receipts",
    pitch: "Stripe API. Better fees. Your own logo.",
    family: "commerce",
    accent: "#B388FF",
    mode: "dark",
    fileName: "receipts.html",
    description: "Developer-first payment processor.",
  },
];

export type TemplateId = (typeof TEMPLATES)[number]["id"];

export function isTemplateId(id: string): boolean {
  return TEMPLATES.some((t) => t.id === id);
}

export function getTemplate(id: string): TemplateEntry | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

export function templatesByFamily(family: TemplateFamily): TemplateEntry[] {
  return TEMPLATES.filter((t) => t.family === family);
}

/** Public URL the workspace iframe / preview frame loads to render the
 *  template HTML directly. Next serves /public/templates/curated/* as
 *  static files; no API roundtrip needed. */
export function templatePreviewUrl(t: TemplateEntry): string {
  return `/templates/curated/${t.fileName}`;
}
