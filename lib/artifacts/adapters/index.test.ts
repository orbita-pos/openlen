// @vitest-environment node
import { afterAll, expect, it } from "vitest";
import { createArtifactAdapters, type IsolatedRendererFactory } from "./index";
import { dashboardFixture } from "../testing/dashboard";
import { pcmToWav } from "./audio/pcm";
import { stopBundlerWorker } from "../../apps/bundler/bundle-app";
import { ArtifactError, type SealedArtifactInput } from "../types";

afterAll(() => stopBundlerWorker());

const env = {
  OPENLEN_ARTIFACTS: "1",
  OPENLEN_ARTIFACT_RENDERER_IMAGE: "openlen/artifact-renderer:1",
  OPENLEN_ARTIFACT_MOTION_VERIFIED: "1",
  OPENLEN_ARTIFACT_AUDIO_VERIFIED: "1",
  OPENAI_API_KEY: "test-key-not-a-credential",
  OPENLEN_ARTIFACT_IMAGE_CENTICREDITS: "500",
  OPENLEN_ARTIFACT_RENDER_CENTICREDITS: "0",
  OPENLEN_ARTIFACT_AUDIO_CENTICREDITS: "25",
};
const token = "11111111-2222-3333-4444-555555555555";
const hooks = { beforeIsolatedRender: async () => undefined, beforeExternalCall: async () => undefined, recordExternalOutcome: async () => undefined };

function recording(seen: string[]): IsolatedRendererFactory {
  return (image, fencingToken) => async (packet) => {
    seen.push(`${image}|${fencingToken}|${packet.kind}`);
    throw new ArtifactError("stop_at_renderer");
  };
}

it("routes an isolated render through the injected renderer with the job's fencing token", async () => {
  const seen: string[] = [];
  const adapters = createArtifactAdapters(env, recording(seen));
  const input = { ...dashboardFixture(), jobIdentity: { id: "job", fencingToken: token } } as SealedArtifactInput;
  await expect(adapters.dashboard!(input, new AbortController().signal, hooks)).rejects.toMatchObject({ code: "stop_at_renderer" });
  expect(seen).toEqual([`openlen/artifact-renderer:1|${token}|dashboard`]);
}, 60_000);

it("leaves the platform to the renderer: audio reaches an injected one on any OS", async () => {
  const seen: string[] = [];
  const adapters = createArtifactAdapters(env, recording(seen));
  const wav = pcmToWav(new Uint8Array(48000)).wav;
  const input = {
    artifact: { kind: "audio" },
    revision: { files: { "audio.json": JSON.stringify({ version: 1, durationSeconds: 2, tracks: [{ asset: "upload:" + "a".repeat(64) + ".wav", role: "music" }] }) } },
    assets: [{ id: "upload:" + "a".repeat(64) + ".wav", mime: "audio/wav", bytes: wav }],
    datasets: [],
    jobIdentity: { id: "job", fencingToken: token },
  } as unknown as SealedArtifactInput;
  await expect(adapters.audio!(input, new AbortController().signal, hooks)).rejects.toMatchObject({ code: "stop_at_renderer" });
  expect(seen).toEqual([`openlen/artifact-renderer:1|${token}|audio`]);
});
