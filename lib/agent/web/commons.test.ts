// Wikimedia Commons, read for `image_search` (spec local 2026-10-27-chat-drop-and-images, Part B):
// the photos in Commons' own order, each with its author and license as plain text, and nothing
// that isn't a photo the chat can show (a drawing in SVG, a PDF page, a sound).
import { describe, expect, it } from "vitest";

import axolotl from "./__fixtures__/commons-axolotl.json";
import { commonsSearchUrl, creditLine, photosFromCommons } from "./commons";

describe("photosFromCommons", () => {
  it("keeps Commons' order and drops what isn't a photo (an SVG)", () => {
    expect(photosFromCommons(axolotl).map((p) => p.title)).toEqual(["Ambystoma mexicanum 1", "Axolotl en el acuario"]);
  });

  it("gives each photo its credit as plain text, the thumbnail without tracking, and the Commons page", () => {
    const [p] = photosFromCommons(axolotl);
    expect(p).toEqual({
      title: "Ambystoma mexicanum 1",
      thumbUrl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Ambystoma_mexicanum_1.jpg/960px-Ambystoma_mexicanum_1.jpg",
      width: 960,
      height: 863,
      mime: "image/jpeg",
      author: "Stan Shebs",
      license: "CC BY-SA 3.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Ambystoma_mexicanum_1.jpg",
      description: "Photo of Ambystoma mexicanum (axolotl) at the Steinhart Aquarium in San Francisco",
    });
  });

  it("an empty author is «Unknown author», a missing license URL is null", () => {
    const p = photosFromCommons(axolotl)[1]!;
    expect(p.author).toBe("Unknown author");
    expect(p.licenseUrl).toBeNull();
  });

  it("anything else is no photos, never a throw", () => {
    expect(photosFromCommons(null)).toEqual([]);
    expect(photosFromCommons({ query: { pages: "x" } })).toEqual([]);
    expect(photosFromCommons({ batchcomplete: true })).toEqual([]);
  });
});

describe("creditLine and commonsSearchUrl", () => {
  it("the credit line a page shows next to the photo", () => {
    expect(creditLine({ author: "Stan Shebs", license: "CC BY-SA 3.0" })).toBe("Photo: Stan Shebs, CC BY-SA 3.0, via Wikimedia Commons");
  });

  it("searches files, bitmaps only, with the metadata the credit needs", () => {
    const u = new URL(commonsSearchUrl("axolotl", 6));
    expect(u.origin + u.pathname).toBe("https://commons.wikimedia.org/w/api.php");
    expect(u.searchParams.get("gsrsearch")).toBe("axolotl filetype:bitmap");
    expect(u.searchParams.get("gsrnamespace")).toBe("6");
    expect(u.searchParams.get("gsrlimit")).toBe("6");
    expect(u.searchParams.get("iiurlwidth")).toBe("960");
    expect(u.searchParams.get("iiextmetadatafilter")).toBe("Artist|LicenseShortName|LicenseUrl|ImageDescription");
    expect(u.searchParams.get("formatversion")).toBe("2");
  });
});
