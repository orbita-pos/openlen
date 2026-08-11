import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/images", () => ({
  processImage: async ({ input, variants }: { input: Buffer; variants: Array<{ format: string }> }) => ({
    variants: variants.map((variant) => ({
      width: input.readUIntLE(24, 3) + 1,
      height: input.readUIntLE(27, 3) + 1,
      format: variant.format,
      mime: `image/${variant.format}`,
      bytes: input,
      size: input.length,
    })),
  }),
}));

import {
  resolveCuratedAssetPack,
  verifyCuratedAssetBytes,
  type CuratedAssetDependencies,
} from "@/lib/generation/asset-catalog";
import type { AssetIntent } from "@/lib/generation/asset-contracts";
import { COLORING_DIRECTION } from "@/lib/generation/creative-fixtures.test-support";
import { CreativeDirectionSchema, type CreativeDirection } from "@/lib/generation/creative-contracts";
import type { CuratedImage } from "@/lib/imagery/manifest";

function webp(width = 1200, height = 630): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write("VP8X", 12, "ascii");
  bytes.writeUInt32LE(10, 16);
  payload.copy(bytes, 20);
  return bytes;
}

const VALID_WEBP = webp();
const VALID_CHECKSUM = `sha256:${createHash("sha256").update(VALID_WEBP).digest("hex")}`;

function response(bytes: Buffer, contentType = "image/webp", contentLength = bytes.length): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": contentType, "content-length": String(contentLength) },
  });
}

function fixtureDeps(
  bytesByUrl: ReadonlyMap<string, Buffer> = new Map(),
  requestedUrls: string[] = [],
): CuratedAssetDependencies {
  return {
    fetchImpl: async (url, init) => {
      if (init?.redirect !== "error") throw new Error("redirect_policy_not_enforced");
      const key = String(url);
      requestedUrls.push(key);
      const bytes = bytesByUrl.get(key) ?? VALID_WEBP;
      return response(bytes);
    },
  };
}

function intent(input: {
  slotIndex?: number;
  role?: "hero" | "section" | "card";
  domain: string;
  audience: string;
  mediaType: "photo" | "illustration" | "texture";
  subject: string;
  forbidden?: string;
  requiredSignals?: string[];
  required?: boolean;
  identityBearing?: boolean;
}): AssetIntent {
  return {
    slotIndex: input.slotIndex ?? 0,
    role: input.role ?? "hero",
    required: input.required ?? true,
    identityBearing: input.identityBearing ?? true,
    mediaType: input.mediaType,
    subjects: [input.subject],
    domains: [input.domain],
    audiences: [input.audience],
    visualArchetype: "editorial_focus",
    emotionalTone: ["bright"],
    aspectRatio: "16:9",
    focalPoint: "center",
    alt: `${input.subject} image`,
    requiredSignals: input.requiredSignals ?? [],
    forbiddenSignals: [input.forbidden ?? "forbidden_signal"],
  };
}

function direction(mediaType: "photo" | "illustration" | "texture", subject: string, forbidden = "forbidden_signal"): CreativeDirection {
  const strategy = mediaType === "photo" ? "photo_first" : mediaType === "illustration" ? "illustration_first" : "texture_first";
  return CreativeDirectionSchema.parse({
    ...COLORING_DIRECTION,
    visualArchetype: "editorial_focus",
    emotionalTone: ["bright"],
    imagery: { strategy, artDirection: "editorial_focus", subjects: [subject], avoid: [forbidden] },
    requiredVisualSignals: [],
    forbiddenVisualSignals: [forbidden],
  });
}

function image(input: {
  id: string;
  domain: string;
  audience?: string;
  mediaType: "photo" | "illustration" | "texture";
  subject: string;
  style?: string;
  visualSignals?: string[];
  url?: string;
  checksum?: string;
  license?: "openlen_catalog";
}): CuratedImage {
  const url = input.url ?? `https://images.openlen.com/${input.id}.webp`;
  return {
    id: input.id,
    promptNum: 1,
    style: input.style ?? "editorial-focus",
    family: [input.domain.replaceAll("_", "-")],
    alt: `Bright ${input.subject} ${input.mediaType} for a ${input.id}`,
    src: { hero: url, tablet: url, thumb: url },
    domains: [input.domain],
    ...(input.audience ? { audiences: [input.audience] } : {}),
    visualSignals: input.visualSignals ?? [input.subject],
    mediaType: input.mediaType,
    license: input.license ?? "openlen_catalog",
    ...(input.checksum ? { checksum: input.checksum } : {}),
  };
}

const DOMAIN_CASES = [
  { label: "coloring", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "coloring_pages" },
  { label: "hotel", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room" },
  { label: "observability", domain: "developer_tools", audience: "engineers", mediaType: "photo", subject: "telemetry_screen" },
  { label: "restaurant", domain: "food_beverage", audience: "diners", mediaType: "photo", subject: "seasonal_plate" },
  { label: "portfolio", domain: "art_portfolio", audience: "collectors", mediaType: "photo", subject: "artist_studio" },
] as const;

describe("resolveCuratedAssetPack hard gates", () => {
  it.each(DOMAIN_CASES)("selects only the deterministic exact $label candidate", async (fixture) => {
    const otherMedia = fixture.mediaType === "illustration" ? "photo" : "illustration";
    const images: CuratedImage[] = [
      image({ ...fixture, id: `${fixture.label}-z-equal` }),
      image({ ...fixture, id: `${fixture.label}-wrong-domain`, domain: "unrelated_domain" }),
      image({ ...fixture, id: `${fixture.label}-forbidden`, visualSignals: [fixture.subject, "forbidden_signal"] }),
      image({ ...fixture, id: `${fixture.label}-wrong-media`, mediaType: otherMedia }),
      image({ ...fixture, id: `${fixture.label}-a-equal` }),
    ];
    const requested: string[] = [];

    const result = await resolveCuratedAssetPack({
      intents: [intent(fixture)],
      direction: direction(fixture.mediaType, fixture.subject),
      images,
      catalogVersion: "fixture/1",
    }, fixtureDeps(new Map(), requested));

    expect(result.status).toBe("complete");
    expect(result.consistencyGroup?.mediaType).toBe(fixture.mediaType);
    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual([`${fixture.label}-a-equal`]);
    expect(result.rejections).toMatchObject({ wrong_domain: 1, forbidden_signal: 1, wrong_media: 1 });
    expect(requested).toEqual([`https://images.openlen.com/${fixture.label}-a-equal.webp`]);
  });

  it("normalizes legacy hyphenated family domains only inside resolution", async () => {
    const legacy: CuratedImage = {
      id: "legacy-telemetry",
      promptNum: 9,
      style: "developer-tools-photo",
      family: ["developer-tools"],
      alt: "Bright telemetry screen photo",
      src: {
        hero: "https://images.openlen.com/legacy-telemetry.webp",
        tablet: "https://images.openlen.com/legacy-telemetry.webp",
        thumb: "https://images.openlen.com/legacy-telemetry.webp",
      },
    };
    const result = await resolveCuratedAssetPack({
      intents: [intent({ domain: "developer_tools", audience: "engineers", mediaType: "photo", subject: "telemetry_screen" })],
      direction: direction("photo", "telemetry_screen"),
      images: [legacy],
      catalogVersion: "legacy/1",
    }, fixtureDeps());

    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual(["legacy-telemetry"]);
    expect(legacy.family).toEqual(["developer-tools"]);
  });

  it("rejects unknown audience metadata for children while allowing explicitly reviewed children assets", async () => {
    const unknown = image({ id: "a-unknown-audience", domain: "children_entertainment", mediaType: "illustration", subject: "coloring_pages" });
    delete unknown.audiences;
    const explicit = image({ id: "z-explicit-children", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "coloring_pages" });
    const result = await resolveCuratedAssetPack({
      intents: [intent({ domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "coloring_pages" })],
      direction: direction("illustration", "coloring_pages"),
      images: [unknown, explicit],
      catalogVersion: "fixture/1",
    }, fixtureDeps());

    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual(["z-explicit-children"]);
    expect(result.rejections.wrong_audience).toBe(1);
  });

  it("rejects invalid provenance and non-exact catalog hosts before fetching", async () => {
    const badLicense = { ...image({ id: "bad-license", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room" }), license: "vendor_upload" } as unknown as CuratedImage;
    const badHost = image({ id: "bad-host", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", url: "https://cdn.images.openlen.com/bad-host.webp" });
    const good = image({ id: "good-hotel", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room" });
    const requested: string[] = [];
    const result = await resolveCuratedAssetPack({
      intents: [intent({ domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room" })],
      direction: direction("photo", "hotel_room"),
      images: [badLicense, badHost, good],
      catalogVersion: "fixture/1",
    }, fixtureDeps(new Map(), requested));

    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual(["good-hotel"]);
    expect(result.rejections).toMatchObject({ invalid_provenance: 1, untrusted_url: 1 });
    expect(requested).toEqual(["https://images.openlen.com/good-hotel.webp"]);
  });

  it("requires every normalized positive signal before scoring", async () => {
    const missing = image({ id: "a-incomplete", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", visualSignals: ["sunlit-room"] });
    const complete = image({ id: "z-complete-signals", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", visualSignals: ["sunlit_room", "accessible-entry"] });
    const requested: string[] = [];
    const result = await resolveCuratedAssetPack({
      intents: [intent({
        domain: "hospitality",
        audience: "travelers",
        mediaType: "photo",
        subject: "hotel_room",
        requiredSignals: ["sunlit_room", "accessible_entry"],
      })],
      direction: direction("photo", "hotel_room"),
      images: [missing, complete],
      catalogVersion: "fixture/1",
    }, fixtureDeps(new Map(), requested));

    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual(["z-complete-signals"]);
    expect(result.rejections.missing_required_signal).toBe(1);
    expect(requested).toEqual(["https://images.openlen.com/z-complete-signals.webp"]);
  });
});

describe("resolveCuratedAssetPack coherent selection", () => {
  const crayons = intent({ slotIndex: 0, domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "crayons" });
  const animals = intent({ slotIndex: 1, role: "section", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "friendly_animals" });

  it("searches compatible style groups before choosing primary winners", async () => {
    const result = await resolveCuratedAssetPack({
      intents: [crayons, animals],
      direction: direction("illustration", "coloring_pages"),
      images: [
        image({ id: "isolated-crayons", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "crayons", style: "a-isolated-style" }),
        image({ id: "friendly-animal-art", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "friendly_animals", style: "hand_drawn_illustration" }),
        image({ id: "coloring-crayons", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "crayons", style: "hand-drawn-illustration" }),
      ],
      catalogVersion: "fixture/1",
    }, fixtureDeps());

    expect(result).toMatchObject({ status: "complete", consistencyGroup: { mediaType: "illustration", styleLock: "hand_drawn_illustration" } });
    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual(["coloring-crayons", "friendly-animal-art"]);
  });

  it("fails closed when required primary slots cannot share one style lock", async () => {
    const result = await resolveCuratedAssetPack({
      intents: [crayons, animals],
      direction: direction("illustration", "coloring_pages"),
      images: [
        image({ id: "only-crayons", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "crayons", style: "crayon-collage" }),
        image({ id: "only-animals", domain: "children_entertainment", audience: "children", mediaType: "illustration", subject: "friendly_animals", style: "animal-watercolor" }),
      ],
      catalogVersion: "fixture/1",
    }, fixtureDeps());

    expect(result).toMatchObject({ status: "incomplete", consistencyGroup: null, assignments: [], unresolvedSlotIndexes: [0, 1] });
  });

  it("continues to the next eligible winner after invalid bytes or checksum mismatch", async () => {
    const invalidUrl = "https://images.openlen.com/a-invalid.webp";
    const mismatchUrl = "https://images.openlen.com/b-checksum-mismatch.webp";
    const validUrl = "https://images.openlen.com/c-valid.webp";
    const requested: string[] = [];
    const result = await resolveCuratedAssetPack({
      intents: [intent({ domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room" })],
      direction: direction("photo", "hotel_room"),
      images: [
        image({ id: "a-invalid", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", url: invalidUrl }),
        image({ id: "b-checksum-mismatch", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", url: mismatchUrl, checksum: `sha256:${"0".repeat(64)}` }),
        image({ id: "c-valid", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", url: validUrl, checksum: VALID_CHECKSUM }),
      ],
      catalogVersion: "fixture/1",
    }, fixtureDeps(new Map([[invalidUrl, Buffer.from("not an image")], [mismatchUrl, VALID_WEBP], [validUrl, VALID_WEBP]]), requested));

    expect(result.assignments).toEqual([expect.objectContaining({ assetId: "c-valid", checksum: VALID_CHECKSUM, width: 1200, height: 630 })]);
    expect(result.rejections.invalid_bytes).toBe(2);
    expect(requested).toEqual([invalidUrl, mismatchUrl, validUrl]);
  });

  it("continues to a compatible winner when verified dimensions have the wrong aspect ratio", async () => {
    const portraitUrl = "https://images.openlen.com/a-portrait.webp";
    const landscapeUrl = "https://images.openlen.com/b-landscape.webp";
    const requested: string[] = [];
    const result = await resolveCuratedAssetPack({
      intents: [intent({ domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room" })],
      direction: direction("photo", "hotel_room"),
      images: [
        image({ id: "a-portrait", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", url: portraitUrl }),
        image({ id: "b-landscape", domain: "hospitality", audience: "travelers", mediaType: "photo", subject: "hotel_room", url: landscapeUrl }),
      ],
      catalogVersion: "fixture/1",
    }, fixtureDeps(new Map([[portraitUrl, webp(630, 1200)], [landscapeUrl, webp(1200, 630)]]), requested));

    expect(result.assignments.map((assignment) => assignment.assetId)).toEqual(["b-landscape"]);
    expect(result.rejections.wrong_aspect_ratio).toBe(1);
    expect(requested).toEqual([portraitUrl, landscapeUrl]);
  });
});

describe("verifyCuratedAssetBytes", () => {
  it("enforces redirect errors and reuses a trusted URL promise", async () => {
    const url = "https://images.openlen.com/cache-fixture.webp";
    let requests = 0;
    const deps: CuratedAssetDependencies = {
      fetchImpl: async (_url, init) => {
        if (init?.redirect !== "error") throw new Error("redirect_policy_not_enforced");
        requests += 1;
        if (requests > 1) throw new Error("promise_cache_missed");
        return response(VALID_WEBP);
      },
    };

    await expect(Promise.all([verifyCuratedAssetBytes(url, deps), verifyCuratedAssetBytes(url, deps)])).resolves.toEqual([
      expect.objectContaining({ checksum: VALID_CHECKSUM, width: 1200, height: 630 }),
      expect.objectContaining({ checksum: VALID_CHECKSUM, width: 1200, height: 630 }),
    ]);
    expect(requests).toBe(1);
  });

  it.each([
    "http://images.openlen.com/file.webp",
    "https://cdn.images.openlen.com/file.webp",
    "https://images.openlen.com:444/file.webp",
    "https://user@images.openlen.com/file.webp",
    "https://images.openlen.com/file.webp?variant=1",
  ])("rejects an untrusted catalog URL without fetching: %s", async (url) => {
    await expect(verifyCuratedAssetBytes(url, { fetchImpl: async () => { throw new Error("network_must_not_run"); } })).rejects.toThrow("untrusted_catalog_url");
  });

  it("rejects a declared response above 6 MiB without reading it", async () => {
    await expect(verifyCuratedAssetBytes("https://images.openlen.com/oversized.webp", {
      fetchImpl: async () => response(Buffer.alloc(0), "image/webp", 6 * 1024 * 1024 + 1),
    })).rejects.toThrow("image_too_large");
  });
});
