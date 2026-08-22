import { canonicalJsonSha256, sha256 } from "./content-hash";

export const FABLE_PARITY_NICHES = [
  "childrens_creativity",
  "psychological_horror_vhs",
  "comedy",
  "game_launch",
  "school_community",
  "editorial_cooking",
  "boutique_hospitality",
  "physical_product",
  "music_culture",
  "nonprofit_cause",
  "luxury_editorial",
  "unusual",
] as const;

export const FABLE_PARITY_FORBIDDEN_SIGNALS = [
  "generic_saas",
  "generic_ai_gradient",
  "unrelated_corporate_photography",
  "wrong_audience",
  "wrong_era",
  "wrong_genre",
  "luxury_cliche",
  "illegible_display_type",
  "placeholder_copy",
  "unsafe_or_external_action",
] as const;

export type FableParityNiche = typeof FABLE_PARITY_NICHES[number];
export type FableParityForbiddenSignal = typeof FABLE_PARITY_FORBIDDEN_SIGNALS[number];

export interface FableParityPrompt {
  readonly recordId: string;
  readonly version: "public/1" | `hidden/${number}`;
  readonly prompt: string;
  readonly niche: FableParityNiche;
  readonly direction: "explicit" | "underspecified";
  readonly forbiddenSignals: readonly FableParityForbiddenSignal[];
}

export interface SealedHiddenRecord {
  readonly sealedId: string;
  readonly ciphertextBase64: string;
  readonly nonceBase64: string;
  readonly authTagBase64: string;
}

export interface FableParityCohortRow {
  readonly ordinal: number;
  readonly comparisonId: string;
  readonly prompt: FableParityPrompt;
}

const PUBLIC: readonly FableParityPrompt[] = [
  {
    recordId: "public-childrens-creativity-01",
    version: "public/1",
    prompt: "Create a joyful children's art-club landing page with wax-crayon texture, hand-cut shapes, playful type, and a clear invitation for families to join weekend workshops.",
    niche: "childrens_creativity",
    direction: "explicit",
    forbiddenSignals: ["generic_saas", "unrelated_corporate_photography", "wrong_audience"],
  },
  {
    recordId: "public-psychological-horror-vhs-02",
    version: "public/1",
    prompt: "Launch an unsettling psychological-horror short film as a damaged late-night VHS transmission, with tracking noise, restrained blood-red accents, credits, and screening details.",
    niche: "psychological_horror_vhs",
    direction: "explicit",
    forbiddenSignals: ["generic_saas", "generic_ai_gradient", "wrong_genre"],
  },
  {
    recordId: "public-comedy-03",
    version: "public/1",
    prompt: "Make a landing page for a new live comedy night called The Awkward Pause. It should feel confident, funny, and easy to book without looking like a software startup.",
    niche: "comedy",
    direction: "underspecified",
    forbiddenSignals: ["generic_saas", "placeholder_copy", "wrong_genre"],
  },
  {
    recordId: "public-game-launch-04",
    version: "public/1",
    prompt: "Design a cinematic launch page for a cooperative deep-sea exploration game: bioluminescent darkness, mission dossier details, crew roles, screenshots, and a strong wishlist action.",
    niche: "game_launch",
    direction: "explicit",
    forbiddenSignals: ["generic_saas", "unrelated_corporate_photography", "wrong_genre"],
  },
  {
    recordId: "public-school-community-05",
    version: "public/1",
    prompt: "Build a welcoming page for a neighborhood school's spring community day with activities, timetable, accessibility information, and a simple way for parents to participate.",
    niche: "school_community",
    direction: "underspecified",
    forbiddenSignals: ["generic_saas", "wrong_audience", "placeholder_copy"],
  },
  {
    recordId: "public-editorial-cooking-06",
    version: "public/1",
    prompt: "Create an editorial cooking landing page devoted to fire-roasted tomatoes, using magazine-like typography, ingredient photography, recipe steps, chef notes, and warm Mediterranean color.",
    niche: "editorial_cooking",
    direction: "explicit",
    forbiddenSignals: ["generic_saas", "unrelated_corporate_photography", "placeholder_copy"],
  },
  {
    recordId: "public-boutique-hospitality-07",
    version: "public/1",
    prompt: "Make a site for a tiny desert guesthouse with six rooms, slow mornings, local excursions, and direct reservations. Give it a memorable identity rather than standard hotel-template luxury.",
    niche: "boutique_hospitality",
    direction: "underspecified",
    forbiddenSignals: ["generic_saas", "luxury_cliche", "unrelated_corporate_photography"],
  },
  {
    recordId: "public-physical-product-08",
    version: "public/1",
    prompt: "Launch a modular analog desk lamp made from anodized aluminum, with exploded-product composition, tactile closeups, specifications, finishes, and a clear preorder story.",
    niche: "physical_product",
    direction: "explicit",
    forbiddenSignals: ["generic_saas", "generic_ai_gradient", "unrelated_corporate_photography"],
  },
  {
    recordId: "public-music-culture-09",
    version: "public/1",
    prompt: "Create a landing page for an independent listening-room series celebrating border-city vinyl culture, upcoming sessions, resident selectors, and a small archive of past nights.",
    niche: "music_culture",
    direction: "underspecified",
    forbiddenSignals: ["generic_saas", "wrong_era", "placeholder_copy"],
  },
  {
    recordId: "public-nonprofit-cause-10",
    version: "public/1",
    prompt: "Design a credible campaign page for restoring an urban river, showing the local stakes, measurable work, volunteer dates, transparent funding, and a hopeful donation invitation.",
    niche: "nonprofit_cause",
    direction: "underspecified",
    forbiddenSignals: ["generic_saas", "unrelated_corporate_photography", "placeholder_copy"],
  },
  {
    recordId: "public-luxury-editorial-11",
    version: "public/1",
    prompt: "Present a limited collection of hand-finished fountain pens through quiet editorial art direction, macro material studies, atelier provenance, restrained typography, and private ordering.",
    niche: "luxury_editorial",
    direction: "explicit",
    forbiddenSignals: ["generic_saas", "generic_ai_gradient", "luxury_cliche"],
  },
  {
    recordId: "public-unusual-12",
    version: "public/1",
    prompt: "Build a distinctive page for a traveling museum of imaginary municipal warning signs, with exhibit stops, field notes, strange classifications, and a way to submit sightings.",
    niche: "unusual",
    direction: "underspecified",
    forbiddenSignals: ["generic_saas", "placeholder_copy", "wrong_genre"],
  },
];

export const FABLE_PARITY_PUBLIC_COHORT = Object.freeze(PUBLIC.map((row) => Object.freeze({
  ...row,
  forbiddenSignals: Object.freeze([...row.forbiddenSignals]),
})));

const nicheSet = new Set<string>(FABLE_PARITY_NICHES);
const forbiddenSet = new Set<string>(FABLE_PARITY_FORBIDDEN_SIGNALS);
const sealedKeys = ["authTagBase64", "ciphertextBase64", "nonceBase64", "sealedId"];
const promptKeys = ["direction", "forbiddenSignals", "niche", "prompt", "recordId", "version"];

function assertExactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} has unexpected keys or plaintext`);
  }
}

function validBase64(value: unknown): value is string {
  return typeof value === "string" && value.length >= 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function validatePrompt(value: unknown, source: "public" | "hidden"): FableParityPrompt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("hidden prompt must be an object");
  assertExactKeys(value, promptKeys, "hidden prompt");
  const row = value as Record<string, unknown>;
  if (typeof row.recordId !== "string" || !row.recordId.trim()) throw new Error("prompt recordId is required");
  if (typeof row.prompt !== "string" || row.prompt.trim().length < 20) throw new Error("prompt text is required");
  if (source === "public" ? row.version !== "public/1" : !/^hidden\/[1-9][0-9]*$/.test(String(row.version))) {
    throw new Error("invalid prompt version");
  }
  if (!nicheSet.has(String(row.niche))) throw new Error("invalid closed niche");
  if (row.direction !== "explicit" && row.direction !== "underspecified") throw new Error("invalid prompt direction");
  if (!Array.isArray(row.forbiddenSignals) || row.forbiddenSignals.length === 0
    || row.forbiddenSignals.some((signal) => !forbiddenSet.has(String(signal)))
    || new Set(row.forbiddenSignals).size !== row.forbiddenSignals.length) {
    throw new Error("invalid closed forbidden signals");
  }
  return {
    recordId: row.recordId,
    version: row.version as FableParityPrompt["version"],
    prompt: row.prompt,
    niche: row.niche as FableParityNiche,
    direction: row.direction,
    forbiddenSignals: Object.freeze([...(row.forbiddenSignals as FableParityForbiddenSignal[])]),
  };
}

export async function loadSealedHiddenCohort(
  records: readonly SealedHiddenRecord[],
  decrypt: (record: SealedHiddenRecord, index: number) => Promise<unknown>,
): Promise<readonly FableParityPrompt[]> {
  if (!Array.isArray(records) || records.length !== 8) throw new Error("hidden cohort requires exactly eight sealed records");
  if (typeof decrypt !== "function") throw new Error("external hidden-cohort decryptor is required");
  const sealedIds = new Set<string>();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("invalid sealed hidden record");
    assertExactKeys(record, sealedKeys, "sealed hidden record");
    if (typeof record.sealedId !== "string" || !record.sealedId.trim() || sealedIds.has(record.sealedId)) throw new Error("duplicate or invalid sealed ID");
    if (![record.ciphertextBase64, record.nonceBase64, record.authTagBase64].every(validBase64)) throw new Error("invalid sealed ciphertext");
    sealedIds.add(record.sealedId);
  }
  const prompts: FableParityPrompt[] = [];
  const promptIds = new Set<string>();
  for (let index = 0; index < records.length; index += 1) {
    const prompt = validatePrompt(await decrypt(records[index]!, index), "hidden");
    if (promptIds.has(prompt.recordId)) throw new Error("duplicate decrypted hidden record ID");
    promptIds.add(prompt.recordId);
    prompts.push(Object.freeze(prompt));
  }
  return Object.freeze(prompts);
}

export function opaqueComparisonId(version: string, recordId: string): string {
  if (!version || !recordId) throw new Error("comparison identity input is required");
  return sha256(`fable-parity-comparison/1\0${version}\0${recordId}`).slice("sha256:".length, "sha256:".length + 24);
}

export async function buildFableParityCohort(
  sealedHiddenRecords: readonly SealedHiddenRecord[],
  decrypt: (record: SealedHiddenRecord, index: number) => Promise<unknown>,
): Promise<readonly FableParityCohortRow[]> {
  const hidden = await loadSealedHiddenCohort(sealedHiddenRecords, decrypt);
  const prompts = [...FABLE_PARITY_PUBLIC_COHORT, ...hidden];
  const recordIds = new Set<string>();
  const comparisonIds = new Set<string>();
  return Object.freeze(prompts.map((prompt, index) => {
    if (recordIds.has(prompt.recordId)) throw new Error("duplicate cohort record ID");
    recordIds.add(prompt.recordId);
    const comparisonId = opaqueComparisonId(prompt.version, prompt.recordId);
    if (comparisonIds.has(comparisonId)) throw new Error("duplicate opaque comparison ID");
    comparisonIds.add(comparisonId);
    return Object.freeze({ ordinal: index + 1, comparisonId, prompt });
  }));
}

export function fableParityCohortSha256(rows: readonly FableParityCohortRow[]): string {
  if (!Array.isArray(rows) || rows.length !== 20 || rows.some((row, index) => row.ordinal !== index + 1)) {
    throw new Error("versioned Fable parity cohort must contain exactly 20 ordered rows");
  }
  return canonicalJsonSha256(rows.map((row) => ({
    ordinal: row.ordinal,
    comparisonId: row.comparisonId,
    recordId: row.prompt.recordId,
    version: row.prompt.version,
    promptSha256: sha256(row.prompt.prompt),
    niche: row.prompt.niche,
    direction: row.prompt.direction,
    forbiddenSignals: [...row.prompt.forbiddenSignals],
  })));
}
