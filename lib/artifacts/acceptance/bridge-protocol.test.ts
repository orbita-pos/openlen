// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  decodeRenderResult,
  encodeRenderResult,
  parseBridgeRequest,
  parseBridgeResponse,
  parseDockerMemory,
} from "./bridge-protocol";

const packet = { version: 1, kind: "dashboard", html: "<p>x</p>", width: 1280, height: 720, probes: [] };
const token = "11111111-2222-3333-4444-555555555555";

describe("acceptance bridge protocol", () => {
  it("accepts a render request only with a valid image, token and packet", () => {
    expect(parseBridgeRequest(JSON.stringify({ type: "render", image: "openlen/artifact-renderer:1", token, packet })).type).toBe("render");
    for (const bad of [
      { type: "render", image: "image;rm -rf /", token, packet },
      { type: "render", image: "openlen/artifact-renderer:1", token: "not-a-uuid", packet },
      { type: "render", image: "openlen/artifact-renderer:1", token, packet: { ...packet, kind: "shell" } },
      { type: "exec", image: "openlen/artifact-renderer:1" },
    ]) expect(() => parseBridgeRequest(JSON.stringify(bad))).toThrow();
    expect(() => parseBridgeRequest("{not json")).toThrow();
  });

  it("accepts an inspect request only for the known tools and a plain file name", () => {
    const file = { name: "video.mp4", base64: Buffer.from("x").toString("base64") };
    expect(parseBridgeRequest(JSON.stringify({ type: "inspect", image: "openlen/artifact-renderer:1", tool: "ffprobe", file })).type).toBe("inspect");
    expect(parseBridgeRequest(JSON.stringify({ type: "inspect", image: "openlen/artifact-renderer:1", tool: "versions" })).type).toBe("inspect");
    expect(() => parseBridgeRequest(JSON.stringify({ type: "inspect", image: "openlen/artifact-renderer:1", tool: "sh", file }))).toThrow();
    expect(() => parseBridgeRequest(JSON.stringify({ type: "inspect", image: "openlen/artifact-renderer:1", tool: "pdfinfo", file: { ...file, name: "../etc/passwd" } }))).toThrow();
  });

  it("round-trips every binary output of a render result byte for byte", () => {
    const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37) % 256);
    const result = { png: bytes(300), pages: [bytes(10), bytes(11)], pdf: bytes(40), mp4: bytes(50), mp3: bytes(60), wav: bytes(70), checks: ["a", "b"], layout: { slides: 2 }, audio: { durationSeconds: 8, sampleRate: 48000, channels: 2 }, video: { frameCount: 180, fps: 30, durationSeconds: 6 } };
    const decoded = decodeRenderResult(JSON.parse(JSON.stringify(encodeRenderResult(result))));
    expect(Buffer.from(decoded.png).equals(Buffer.from(result.png))).toBe(true);
    expect(decoded.pages?.map((p) => Buffer.from(p).toString("hex"))).toEqual(result.pages.map((p) => Buffer.from(p).toString("hex")));
    for (const key of ["pdf", "mp4", "mp3", "wav"] as const) expect(Buffer.from(decoded[key]!).equals(Buffer.from(result[key]))).toBe(true);
    expect(decoded).toMatchObject({ checks: ["a", "b"], layout: { slides: 2 }, audio: result.audio, video: result.video });
  });

  it("rejects a result whose bytes or checks are not what the protocol carries", () => {
    expect(() => decodeRenderResult({ png: "@@@", checks: [] })).toThrow();
    expect(() => decodeRenderResult({ png: "", checks: [1] })).toThrow();
    expect(() => decodeRenderResult({ checks: [] })).toThrow();
  });

  it("reads a response, failures included, and refuses anything else", () => {
    const metrics = { ms: 10, peakMemoryBytes: null, peakCpuPercent: null, peakPids: null, samples: 0 };
    const leftovers = { containers: 0, tempDirectories: 0 };
    expect(parseBridgeResponse(JSON.stringify({ ok: false, error: { code: "motion_nondeterministic", message: "[]" }, metrics, leftovers }))).toMatchObject({ ok: false, error: { code: "motion_nondeterministic" } });
    expect(parseBridgeResponse(JSON.stringify({ ok: true, output: "Pages: 2", metrics, leftovers }))).toMatchObject({ ok: true, output: "Pages: 2" });
    expect(() => parseBridgeResponse(JSON.stringify({ ok: true, metrics }))).toThrow();
    expect(() => parseBridgeResponse("")).toThrow();
  });

  it("reads docker's memory column in bytes", () => {
    expect(parseDockerMemory("512MiB / 2GiB")).toBe(512 * 1024 * 1024);
    expect(parseDockerMemory("1.5GiB / 2GiB")).toBe(1.5 * 1024 ** 3);
    expect(parseDockerMemory("800kB / 2GiB")).toBe(800 * 1000);
    expect(parseDockerMemory("0B / 0B")).toBe(0);
    expect(parseDockerMemory("--")).toBeNull();
  });
});
