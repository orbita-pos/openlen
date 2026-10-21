// @vitest-environment node
import { createHash } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { preflightArtifact } from "./preflight";
import { stopBundlerWorker } from "../apps/bundler/bundle-app";
import type { Artifact, ArtifactContext, ArtifactRevision } from "./types";
import type { ArtifactStore } from "./store";

afterAll(() => stopBundlerWorker());
const ctx = { actorId: "owner", ownerId: "owner", projectId: "project", requestId: "r", role: "dueno" } as ArtifactContext;
const store = { getRevision: async () => { throw new Error("no dependencies here"); } } as unknown as ArtifactStore;
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const app = '<html><head></head><body><h1>Reservar</h1></body></html>';
const composition = '<html><head></head><body><img src="asset:capture:reservar" width="1280" height="720"><script src="main.ts"></script></body></html>';
const motion = "window.lenMotion={durationSeconds:1,ready:async()=>{},seek:async()=>{}};";
function revision(files: Record<string, string>): ArtifactRevision {
  return { artifactId: "video", revision: 2, dependencies: [], sealedAt: null, outputs: [], evidence: null, manifest: {}, createdAt: new Date(), sourceRef: { frozenSourcePrefix: "project-source/", files: { "/index.html": hash(app) }, settingsHash: "a".repeat(64), capturedAt: new Date().toISOString(), resourceRefs: [] }, files } as unknown as ArtifactRevision;
}
const manifest = JSON.stringify({ version: 1, entry: "index.html", runtime: "gsap-3.15.0", width: 1280, height: 720, fps: 30, durationSeconds: 1, captures: [{ id: "reservar", entry: "/index.html#/reservar" }] });

it("lets a video show the app screens it captures: a capture is a picture made on render, not a saved one", async () => {
  await expect(preflightArtifact(ctx, store, { kind: "motion" } as Artifact, revision({ "motion.json": manifest, "index.html": composition, "main.ts": motion, "project-source/index.html": app }))).resolves.toBeUndefined();
});

it("still stops a video whose frozen app was edited, saying so", async () => {
  await expect(preflightArtifact(ctx, store, { kind: "motion" } as Artifact, revision({ "motion.json": manifest, "index.html": composition, "main.ts": motion, "project-source/index.html": app.replace("Reservar", "editado") })))
    .rejects.toMatchObject({ code: "frozen_source_changed" });
});
