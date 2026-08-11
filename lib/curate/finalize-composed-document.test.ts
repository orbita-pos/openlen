import { describe, expect, it } from "vitest";

import type { BusinessProfileData } from "@/lib/business-profiles/types";
import { finalizeComposedDocument } from "./finalize-composed-document";

const PROFILE = { brand: { accent: "#F06AA6", logoUrl: null } } as BusinessProfileData;

describe("finalizeComposedDocument", () => {
  it("seeds, completes metadata, and sanitizes a composed document", () => {
    const result = finalizeComposedDocument({
      html: "<!doctype html><html><head></head><body><main><h1>PintaMundo</h1></main></body></html>",
      profileData: PROFILE,
      title: "PintaMundo",
    });

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.html).toContain("<title>PintaMundo</title>");
  });

  it("fails closed when publish sanitization rejects the assembled document", () => {
    expect(finalizeComposedDocument({
      html: "<!doctype html><html><head></head><body><main data-slot-path=\"hero.title\">blocked</main></body></html>",
      profileData: PROFILE,
      title: "PintaMundo",
    })).toEqual({ ok: false, reasonCode: "sanitization_failed" });
  });
});
