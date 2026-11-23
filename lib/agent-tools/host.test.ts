// @vitest-environment node
import { describe, expect, it } from "vitest";

import { etiquetaDeLienzo } from "@/lib/lienzo/host";
import { toolHostLabel, toolPhoneHostLabel } from "@/lib/tools/host";

import { agentToolFrameUrl, agentToolHostLabel, agentToolPhoneHostLabel } from "./host";

const ID = "4f0c2a8e-1b3d-4c5e-9f7a-0b1c2d3e4f5a";
const ENV = { AUTH_SECRET: "s3cret" };

describe("agentToolHostLabel", () => {
  it("has the canvas label's shape, so Caddy and the rewrites already route it", () => {
    expect(agentToolHostLabel(ID, ENV)).toMatch(/^lienzo-[0-9a-f]{32}$/);
  });

  it("is stable per tool and does not depend on the id's case", () => {
    expect(agentToolHostLabel(ID, ENV)).toBe(agentToolHostLabel(ID, ENV));
    expect(agentToolHostLabel(ID.toUpperCase(), ENV)).toBe(agentToolHostLabel(ID, ENV));
  });

  it("changes with the tool and with the secret", () => {
    expect(agentToolHostLabel(ID, ENV)).not.toBe(agentToolHostLabel("00000000-0000-4000-8000-000000000000", ENV));
    expect(agentToolHostLabel(ID, ENV)).not.toBe(agentToolHostLabel(ID, { AUTH_SECRET: "another" }));
  });

  it("falls back to NEXTAUTH_SECRET, and without any secret there is no label", () => {
    expect(agentToolHostLabel(ID, { NEXTAUTH_SECRET: "s3cret" })).toBe(agentToolHostLabel(ID, ENV));
    expect(agentToolHostLabel(ID, {})).toBeNull();
    expect(agentToolHostLabel(ID, { AUTH_SECRET: "  " })).toBeNull();
  });
});

describe("agentToolPhoneHostLabel", () => {
  it("is a lienzo label, stable, and without a secret there is none", () => {
    expect(agentToolPhoneHostLabel(ID, ENV)).toMatch(/^lienzo-[0-9a-f]{32}$/);
    expect(agentToolPhoneHostLabel(ID, ENV)).toBe(agentToolPhoneHostLabel(ID, ENV));
    expect(agentToolPhoneHostLabel(ID, {})).toBeNull();
  });
});

// The labels one id could get must be five different origins: the agent tool's workspace label is framed only by
// openlen.com, its phone label only by the phone app, an installed tool's two labels are looked up in another table
// altogether, and the canvas's is recomputed from a live document.
describe("the labels never meet", () => {
  it("the agent tool's two, an installed tool's two and the canvas's label of the same id are five labels", () => {
    const labels = [
      agentToolHostLabel(ID, ENV),
      agentToolPhoneHostLabel(ID, ENV),
      toolHostLabel(ID, ENV),
      toolPhoneHostLabel(ID, ENV),
      etiquetaDeLienzo(ID, ENV),
    ];
    expect(new Set(labels).size).toBe(labels.length);
  });
});

// A known answer: the HMAC domains are exactly "openlen-agent-tool:" and "openlen-agent-tool-phone:". A label is stored on the
// tool's row, so a change of domain would quietly give new tools different addresses from the old ones.
describe("the labels' known answer", () => {
  it("pins both HMAC domains", () => {
    expect(agentToolHostLabel(ID, ENV)).toBe("lienzo-e21a10dbc607dcfc3fad29657477e312");
    expect(agentToolPhoneHostLabel(ID, ENV)).toBe("lienzo-beab6b1b9edbc0564fa52bbb68b80e34");
  });
});

describe("agentToolFrameUrl", () => {
  const label = "lienzo-0123456789abcdef0123456789abcdef";

  it("in production, on the canvas domain, with the published version in the URL", () => {
    expect(
      agentToolFrameUrl({ hostLabel: label, releaseSha: "abc", requestHost: "openlen.com" }, { NODE_ENV: "production", LIENZO_BASE_HOST: "openlen.app" }),
    ).toBe(`https://${label}.openlen.app/?v=abc`);
  });

  it("locally, on .localhost with the request's port", () => {
    expect(agentToolFrameUrl({ hostLabel: label, releaseSha: "abc", requestHost: "localhost:3000" }, { NODE_ENV: "development" })).toBe(
      `http://${label}.localhost:3000/?v=abc`,
    );
  });

  it("with the canvas origin switched off, there is nowhere isolated to serve it", () => {
    expect(agentToolFrameUrl({ hostLabel: label, releaseSha: "abc", requestHost: "localhost:3000" }, { OPENLEN_LIENZO_ORIGEN: "0" })).toBeNull();
  });
});
