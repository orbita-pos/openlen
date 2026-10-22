// @vitest-environment node
import { describe, expect, it } from "vitest";

import { BOX_MARKER_HEADER, boxMarker, projectOfBoxMarker } from "./box-marker";

const ENV = { AUTH_SECRET: "s3cret" };
const P = "2c1a4308-d063-47f0-b94b-297b32327437";
const OTHER = "c67fc292-c1af-4f30-822e-685b5a98c8f5";

describe("the box's marker", () => {
  it("is the project and an HMAC no one without the secret can make", () => {
    const m = boxMarker(P, ENV)!;
    expect(m.startsWith(`${P}.`)).toBe(true);
    expect(m).not.toBe(boxMarker(P, { AUTH_SECRET: "other" }));
    expect(boxMarker(OTHER, ENV)).not.toBe(m);
  });

  it("gives back its project, and nothing for a forged or broken one", () => {
    expect(projectOfBoxMarker(boxMarker(P, ENV), ENV)).toBe(P);
    expect(projectOfBoxMarker(`${P}.${"0".repeat(32)}`, ENV)).toBeNull();
    expect(projectOfBoxMarker(boxMarker(OTHER, ENV)!.replace(OTHER, P), ENV)).toBeNull();
    for (const bad of [null, "", "x", `${P}`, `${P}.`, "not-a-uuid.abc"]) expect(projectOfBoxMarker(bad, ENV)).toBeNull();
  });

  it("without a secret there is no marker", () => {
    expect(boxMarker(P, {})).toBeNull();
    expect(projectOfBoxMarker(`${P}.${"0".repeat(32)}`, {})).toBeNull();
  });

  it("travels in one header", () => {
    expect(BOX_MARKER_HEADER).toBe("x-openlen-caja");
  });
});
