import type { AssetIntent, AssetMediaType } from "@/lib/generation/asset-contracts";
import { validateGeneratedImage, type ValidatedImage } from "@/lib/generation/asset-image-validation";
import type { CreativeDirection } from "@/lib/generation/creative-contracts";
import type { CuratedImage } from "@/lib/imagery/manifest";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const CHILDREN_AUDIENCE = "children";

export interface CuratedAssetDependencies {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface ResolveCuratedAssetPackInput {
  intents: readonly AssetIntent[];
  direction: CreativeDirection;
  images: readonly CuratedImage[];
  catalogVersion: string;
}

export interface CuratedAssetAssignment extends ValidatedImage {
  slotIndex: number;
  assetId: string;
  url: string;
  styleLock: string;
  score: number;
  provenance: { catalogVersion: string; license: "openlen_catalog" };
}

export type CuratedAssetRejectionReason =
  | "wrong_domain"
  | "wrong_audience"
  | "wrong_media"
  | "missing_required_signal"
  | "forbidden_signal"
  | "invalid_provenance"
  | "untrusted_url"
  | "wrong_aspect_ratio"
  | "invalid_bytes";

export interface CuratedAssetPackResult {
  status: "complete" | "incomplete";
  catalogVersion: string;
  consistencyGroup: {
    mediaType: AssetMediaType;
    artDirection: string;
    styleLock: string;
  } | null;
  assignments: CuratedAssetAssignment[];
  unresolvedSlotIndexes: number[];
  rejections: Record<CuratedAssetRejectionReason, number>;
}

interface RankedCandidate {
  image: CuratedImage;
  url: string;
  mediaType: AssetMediaType;
  styleLock: string;
  score: number;
}

const verificationCache = new Map<string, Promise<ValidatedImage>>();

function hasTraversal(value: string): boolean {
  let decoded = value.split(/[?#]/, 1)[0] ?? "";
  for (let pass = 0; pass <= 8; pass += 1) {
    if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)) return true;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return false;
      if (pass === 8) return true;
      decoded = next;
    } catch {
      return true;
    }
  }
  return false;
}

function trustedCatalogUrl(value: string): boolean {
  if (hasTraversal(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "images.openlen.com"
      && !url.port
      && !url.username
      && !url.password
      && !url.search
      && !url.hash
      && /^\/.+\.(?:png|jpe?g|webp)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

async function readBoundedBytes(response: Response): Promise<Buffer> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) throw new Error("invalid_content_length");
    if (parsedLength > MAX_IMAGE_BYTES) throw new Error("image_too_large");
  }

  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error("image_too_large");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new Error("image_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function verifyCuratedAssetBytes(url: string, deps: CuratedAssetDependencies): Promise<ValidatedImage> {
  if (!trustedCatalogUrl(url)) throw new Error("untrusted_catalog_url");
  let verification = verificationCache.get(url);
  if (!verification) {
    verification = (async () => {
      const response = await deps.fetchImpl(url, { redirect: "error" });
      if (!response.ok) throw new Error("catalog_fetch_failed");
      const declaredMimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (!declaredMimeType) throw new Error("missing_content_type");
      const bytes = await readBoundedBytes(response);
      return validateGeneratedImage(bytes, declaredMimeType);
    })();
    verificationCache.set(url, verification);
    verification.catch(() => verificationCache.delete(url));
  }
  return verification;
}

function normalizeTag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function signalSet(values: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const value of values) {
    const normalized = normalizeTag(value);
    if (!normalized) continue;
    result.add(normalized);
    for (const token of normalized.split("_")) if (token) result.add(token);
  }
  return result;
}

function intersects(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function overlapCount(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function imageMediaType(image: CuratedImage): AssetMediaType {
  if (image.mediaType === "photo" || image.mediaType === "illustration" || image.mediaType === "texture") return image.mediaType;
  const description = normalizeTag(`${image.id} ${image.style} ${image.alt}`);
  if (/(?:^|_)(?:illustration|drawn|drawing|artwork|cartoon|vector)(?:_|$)/.test(description)) return "illustration";
  if (/(?:^|_)(?:texture|pattern|grain|paper)(?:_|$)/.test(description)) return "texture";
  return "photo";
}

function candidateSignals(image: CuratedImage): Set<string> {
  return signalSet([
    image.id,
    image.style,
    image.alt,
    ...image.family,
    ...(image.domains ?? []),
    ...(image.audiences ?? []),
    ...(image.visualSignals ?? []),
  ]);
}

function rejectionReason(image: CuratedImage, intent: AssetIntent, direction: CreativeDirection): CuratedAssetRejectionReason | null {
  const candidateDomains = new Set((image.domains ?? image.family).map(normalizeTag).filter(Boolean));
  const desiredDomains = new Set(intent.domains.map(normalizeTag));
  if (!intersects(candidateDomains, desiredDomains)) return "wrong_domain";

  const desiredAudiences = new Set(intent.audiences.map(normalizeTag));
  const candidateAudiences = image.audiences?.map(normalizeTag).filter(Boolean);
  if (desiredAudiences.has(CHILDREN_AUDIENCE)) {
    if (!candidateAudiences?.includes(CHILDREN_AUDIENCE)) return "wrong_audience";
  } else if (candidateAudiences && !intersects(new Set(candidateAudiences), desiredAudiences)) {
    return "wrong_audience";
  }

  if (imageMediaType(image) !== intent.mediaType) return "wrong_media";

  const signals = candidateSignals(image);
  const required = signalSet([...intent.requiredSignals, ...direction.requiredVisualSignals]);
  for (const requiredSignal of required) if (!signals.has(requiredSignal)) return "missing_required_signal";

  const forbidden = signalSet([...intent.forbiddenSignals, ...direction.imagery.avoid, ...direction.forbiddenVisualSignals]);
  const negativeForIntent = signalSet([
    ...intent.domains,
    ...intent.audiences,
    ...intent.subjects,
    ...intent.requiredSignals,
    ...direction.requiredVisualSignals,
  ]);
  if (intersects(forbidden, signals) || intersects(signalSet(image.negativeTags ?? []), negativeForIntent)) return "forbidden_signal";

  if (image.license !== undefined && image.license !== "openlen_catalog") return "invalid_provenance";
  if (!trustedCatalogUrl(image.src.hero)) return "untrusted_url";
  return null;
}

const ASPECT_RATIO_PARTS: Record<AssetIntent["aspectRatio"], readonly [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "21:9": [21, 9],
};

function aspectRatioIsCompatible(width: number, height: number, aspectRatio: AssetIntent["aspectRatio"]): boolean {
  const [numerator, denominator] = ASPECT_RATIO_PARTS[aspectRatio];
  const crossDifference = Math.abs(width * denominator - height * numerator);
  return crossDifference * 5 <= height * numerator;
}

function scoreCandidate(image: CuratedImage, intent: AssetIntent, direction: CreativeDirection): number {
  const signals = candidateSignals(image);
  const subjects = signalSet([...intent.subjects, ...direction.imagery.subjects]);
  const roles = signalSet([intent.role]);
  const styles = signalSet([intent.visualArchetype, direction.visualArchetype, direction.imagery.artDirection]);
  const tones = signalSet([...intent.emotionalTone, ...direction.emotionalTone, direction.mode === "dark" ? "dark" : "bright"]);
  return overlapCount(subjects, signals) * 100
    + overlapCount(roles, signals) * 20
    + overlapCount(styles, signals) * 10
    + overlapCount(tones, signals);
}

function compareCandidates(left: RankedCandidate, right: RankedCandidate): number {
  if (left.score !== right.score) return right.score - left.score;
  return left.image.id < right.image.id ? -1 : left.image.id > right.image.id ? 1 : 0;
}

function rankedCandidates(
  intent: AssetIntent,
  input: ResolveCuratedAssetPackInput,
  rejections: Record<CuratedAssetRejectionReason, number>,
): RankedCandidate[] {
  const ranked: RankedCandidate[] = [];
  for (const image of input.images) {
    const reason = rejectionReason(image, intent, input.direction);
    if (reason) {
      rejections[reason] += 1;
      continue;
    }
    ranked.push({
      image,
      url: image.src.hero,
      mediaType: imageMediaType(image),
      styleLock: normalizeTag(image.style),
      score: scoreCandidate(image, intent, input.direction),
    });
  }
  return ranked.sort(compareCandidates);
}

async function verifiedAssignment(
  candidate: RankedCandidate,
  intent: AssetIntent,
  input: ResolveCuratedAssetPackInput,
  deps: CuratedAssetDependencies,
  rejections: Record<CuratedAssetRejectionReason, number>,
  invalidAssets: Set<string>,
): Promise<CuratedAssetAssignment | null> {
  if (invalidAssets.has(candidate.image.id)) return null;
  let validated: ValidatedImage;
  try {
    validated = await verifyCuratedAssetBytes(candidate.url, deps);
    if (candidate.image.checksum && candidate.image.checksum !== validated.checksum) throw new Error("checksum_mismatch");
  } catch {
    invalidAssets.add(candidate.image.id);
    rejections.invalid_bytes += 1;
    return null;
  }
  if (!aspectRatioIsCompatible(validated.width, validated.height, intent.aspectRatio)) {
    rejections.wrong_aspect_ratio += 1;
    return null;
  }
  return {
    slotIndex: intent.slotIndex,
    assetId: candidate.image.id,
    url: candidate.url,
    styleLock: candidate.styleLock,
    score: candidate.score,
    provenance: { catalogVersion: input.catalogVersion, license: "openlen_catalog" },
    ...validated,
  };
}

async function resolveStyleGroup(
  intents: readonly AssetIntent[],
  candidates: ReadonlyMap<number, readonly RankedCandidate[]>,
  styleLock: string,
  input: ResolveCuratedAssetPackInput,
  deps: CuratedAssetDependencies,
  rejections: Record<CuratedAssetRejectionReason, number>,
  invalidAssets: Set<string>,
): Promise<CuratedAssetAssignment[] | null> {
  const search = async (index: number, used: ReadonlySet<string>): Promise<CuratedAssetAssignment[] | null> => {
    if (index === intents.length) return [];
    const current = intents[index];
    const eligible = (candidates.get(current.slotIndex) ?? []).filter((candidate) => candidate.styleLock === styleLock && !used.has(candidate.image.id));
    for (const candidate of eligible) {
      const assignment = await verifiedAssignment(candidate, current, input, deps, rejections, invalidAssets);
      if (!assignment) continue;
      const tail = await search(index + 1, new Set([...used, candidate.image.id]));
      if (tail) return [assignment, ...tail];
    }
    return null;
  };
  return search(0, new Set());
}

function emptyRejections(): Record<CuratedAssetRejectionReason, number> {
  return {
    wrong_domain: 0,
    wrong_audience: 0,
    wrong_media: 0,
    missing_required_signal: 0,
    forbidden_signal: 0,
    invalid_provenance: 0,
    untrusted_url: 0,
    wrong_aspect_ratio: 0,
    invalid_bytes: 0,
  };
}

export async function resolveCuratedAssetPack(
  input: ResolveCuratedAssetPackInput,
  deps: CuratedAssetDependencies,
): Promise<CuratedAssetPackResult> {
  const rejections = emptyRejections();
  const sortedIntents = [...input.intents].sort((left, right) => left.slotIndex - right.slotIndex);
  const candidates = new Map(sortedIntents.map((assetIntent) => [assetIntent.slotIndex, rankedCandidates(assetIntent, input, rejections)]));
  const primary = sortedIntents.filter((assetIntent) => assetIntent.required || assetIntent.identityBearing);
  const invalidAssets = new Set<string>();

  if (primary.length > 0 && new Set(primary.map((assetIntent) => assetIntent.mediaType)).size !== 1) {
    return { status: "incomplete", catalogVersion: input.catalogVersion, consistencyGroup: null, assignments: [], unresolvedSlotIndexes: sortedIntents.map((assetIntent) => assetIntent.slotIndex), rejections };
  }

  const styleScores = new Map<string, number>();
  if (primary.length > 0) {
    const firstStyles = new Set((candidates.get(primary[0].slotIndex) ?? []).map((candidate) => candidate.styleLock));
    for (const style of firstStyles) {
      let score = 0;
      let coversAll = true;
      for (const assetIntent of primary) {
        const best = (candidates.get(assetIntent.slotIndex) ?? []).find((candidate) => candidate.styleLock === style);
        if (!best) {
          coversAll = false;
          break;
        }
        score += best.score;
      }
      if (coversAll) styleScores.set(style, score);
    }
  }
  const styles = [...styleScores.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([style]) => style);

  let styleLock: string | null = null;
  let assignments: CuratedAssetAssignment[] = [];
  for (const style of styles) {
    const resolved = await resolveStyleGroup(primary, candidates, style, input, deps, rejections, invalidAssets);
    if (!resolved) continue;
    styleLock = style;
    assignments = resolved;
    break;
  }

  if (primary.length > 0 && !styleLock) {
    return { status: "incomplete", catalogVersion: input.catalogVersion, consistencyGroup: null, assignments: [], unresolvedSlotIndexes: sortedIntents.map((assetIntent) => assetIntent.slotIndex), rejections };
  }

  const used = new Set(assignments.map((assignment) => assignment.assetId));
  for (const assetIntent of sortedIntents.filter((candidateIntent) => !primary.includes(candidateIntent))) {
    const ranked = candidates.get(assetIntent.slotIndex) ?? [];
    const sameStyle = styleLock ? ranked.filter((candidate) => candidate.styleLock === styleLock) : ranked;
    const eligible = sameStyle.length > 0 ? sameStyle : ranked;
    for (const candidate of eligible) {
      if (used.has(candidate.image.id)) continue;
      const assignment = await verifiedAssignment(candidate, assetIntent, input, deps, rejections, invalidAssets);
      if (!assignment) continue;
      assignments.push(assignment);
      used.add(assignment.assetId);
      if (!styleLock) styleLock = assignment.styleLock;
      break;
    }
  }

  assignments = assignments.sort((left, right) => left.slotIndex - right.slotIndex);
  const assignedSlots = new Set(assignments.map((assignment) => assignment.slotIndex));
  const unresolvedSlotIndexes = sortedIntents.filter((assetIntent) => !assignedSlots.has(assetIntent.slotIndex)).map((assetIntent) => assetIntent.slotIndex);
  const requiredUnresolved = sortedIntents.some((assetIntent) => assetIntent.required && !assignedSlots.has(assetIntent.slotIndex));
  const mediaType = primary[0]?.mediaType ?? sortedIntents[0]?.mediaType;
  const consistencyGroup = styleLock && mediaType
    ? { mediaType, artDirection: normalizeTag(input.direction.imagery.artDirection), styleLock }
    : null;
  return {
    status: requiredUnresolved ? "incomplete" : "complete",
    catalogVersion: input.catalogVersion,
    consistencyGroup,
    assignments,
    unresolvedSlotIndexes,
    rejections,
  };
}
