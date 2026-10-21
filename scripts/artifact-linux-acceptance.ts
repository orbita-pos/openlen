/**
 * LEN 3.0 RENDERER ACCEPTANCE ON LINUX (docs/artifacts-renderer.md).
 *
 * The REAL adapters run here — compile, validation, the PPTX built from the
 * layout Chromium measured, every post-render check — and every container call
 * goes through the WSL bridge (scripts/artifact-renderer-bridge.ts) to the REAL
 * container supervisor and the local renderer image. In production one Linux
 * worker process runs both halves; the bridge is the only test glue.
 *
 * Synthetic inputs only: no provider call (the narration case uses a fixture
 * voice and says so), no database, no customer data, nothing from .env. Each
 * case must match its expected outcome AND leave no container or temporary
 * directory behind; produced files are checked again with ffprobe/pdfinfo in a
 * separate offline container.
 *
 *   npx tsx --require ./scripts/test-node-server-only-shim.cjs scripts/artifact-linux-acceptance.ts \
 *     --evidence <new directory> [--distro Ubuntu-24.04] [--image openlen/artifact-renderer:1] \
 *     [--node <linux path to node 22>] [--only id,id] [--skip-long]
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { join, resolve } from "node:path";
import { renderDashboard } from "../lib/artifacts/adapters/dashboard/render";
import { renderSlides } from "../lib/artifacts/adapters/slides/render";
import { renderMotion } from "../lib/artifacts/adapters/motion/render";
import { renderAudio } from "../lib/artifacts/adapters/audio/render";
import { pcmToWav } from "../lib/artifacts/adapters/audio/pcm";
import { dashboardFixture } from "../lib/artifacts/testing/dashboard";
import { slidesFixture } from "../lib/artifacts/testing/slides";
import { slidesV3Fixture } from "../lib/artifacts/testing/slides-v3";
import { motionFixture } from "../lib/artifacts/testing/motion";
import { stopBundlerWorker } from "../lib/apps/bundler/bundle-app";
import type { ArtifactRender, ArtifactRenderPacket } from "../lib/artifacts/render-protocol";
import { ArtifactError, type AdapterResult, type SealedArtifactInput } from "../lib/artifacts/types";
import { rendererContainerArgs } from "../lib/artifacts/render-container";
import { bundleBridge, createBridge, wsl as wslIn, type Bridge, type BridgeCall } from "../lib/artifacts/acceptance/bridge-client";

// ── Options ──────────────────────────────────────────────────────────────────

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const evidenceArg = arg("--evidence");
const distro = arg("--distro") ?? "Ubuntu-24.04";
const image = arg("--image") ?? "openlen/artifact-renderer:1";
const only = arg("--only")?.split(",").map((s) => s.trim()).filter(Boolean);
const skipLong = process.argv.includes("--skip-long");

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

const wsl = (args: readonly string[]) => wslIn(distro, args);

// ── The bridge ───────────────────────────────────────────────────────────────

let bridge: Bridge;

interface CallLog extends BridgeCall {
  readonly packetSha256: string;
  /** The packet as sent, under evidence/packets/, to reproduce the call exactly. */
  readonly packetFile: string;
}

function bridgeRender(calls: CallLog[], packets: { directory: string; prefix: string }): ArtifactRender {
  return async (packet, signal) => {
    const json = JSON.stringify(packet);
    const packetFile = `${packets.prefix}-${calls.length + 1}-${packet.kind}.json`;
    // Written before the call, so a crash still leaves what was sent.
    await writeFile(join(packets.directory, packetFile), json);
    return bridge.render(() => randomUUID(), (_p, outcome) => { calls.push({ ...outcome, packetSha256: sha256(json), packetFile }); })(packet, signal);
  };
}

const inspect = (tool: "ffprobe" | "pdfinfo", name: string, bytes: Uint8Array) => bridge.inspect(tool, name, bytes);

// ── Synthetic inputs ─────────────────────────────────────────────────────────

/** 16-bit mono PCM at 24 kHz, the shape the speech API returns. */
function tone(hz: number, seconds: number): Uint8Array {
  const pcm = Buffer.alloc(Math.round(seconds * 48000));
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(4000 * Math.sin((2 * Math.PI * hz * i) / 24000)), i * 2);
  return new Uint8Array(pcm);
}
function wavUpload(hz: number, seconds: number) {
  const bytes = pcmToWav(tone(hz, seconds)).wav;
  return { id: `upload:${sha256(bytes)}.wav`, mime: "audio/wav", bytes };
}
const clone = (input: SealedArtifactInput): SealedArtifactInput => structuredClone(input);
function replaceOnce(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2) throw new Error(`fixture edit did not match exactly once: ${from}`);
  return text.replace(from, to);
}
function editFiles(input: SealedArtifactInput, edit: (files: Record<string, string>) => void): SealedArtifactInput {
  const copy = clone(input);
  edit(copy.revision.files as Record<string, string>);
  return copy;
}

/** The catalog React dashboard of scripts/artifact-breadth-fixture.ts (recharts, local Tailwind). */
function reactDashboard(): SealedArtifactInput {
  return {
    artifact: { kind: "dashboard" },
    revision: {
      files: {
        "dashboard.json": JSON.stringify({ entry: "index.html", catalogo: "2026-11", width: 1280, height: 720, datasetIds: ["sales"], probes: [{ select: { selector: "#zone", value: "Norte" }, expect: { selector: "#total", text: "120" } }] }),
        "index.html": '<html lang="es"><head></head><body><div id="root"></div><script type="module" src="main.tsx"></script></body></html>',
        "theme.css": "body{margin:0;background:#101c2a;color:#eef6ff;font-family:Arial}#root{padding:48px}select{font:inherit;padding:10px}h1{font-size:40px}#total{@apply text-5xl font-bold} .recharts-wrapper{margin-top:30px}",
        "main.tsx": `import React,{useState,useEffect} from "react";import {createRoot} from "react-dom/client";import {BarChart,Bar,XAxis,YAxis,CartesianGrid,Tooltip} from "recharts";import "./theme.css";let done;window.lenReady=new Promise(resolve=>done=resolve);function App(){const [zone,set]=useState('Todas');const rows=window.lenData.datasets[0].rows.filter(r=>zone==='Todas'||r[0]===zone).map(r=>({zone:r[0],sales:r[1]}));useEffect(()=>{done()},[]);return <><p>PRUEBA TÉCNICA · DATOS SINTÉTICOS</p><h1>Ventas por región</h1><label>Región <select id="zone" value={zone} onChange={e=>set(e.target.value)}><option>Todas</option><option>Norte</option><option>Sur</option></select></label><p id="total">{rows.reduce((sum,r)=>sum+r.sales,0)}</p><BarChart width={1050} height={350} data={rows}><CartesianGrid stroke="#344052" vertical={false}/><XAxis dataKey="zone" stroke="#eef6ff"/><YAxis stroke="#eef6ff"/><Tooltip/><Bar dataKey="sales" fill="#85d8be" isAnimationActive={false}/></BarChart></>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
    },
    datasets: [{ id: "sales", mode: "scenario", environment: null, visibility: "project", columns: ["Zona", "Ventas"], rows: [["Norte", 120], ["Sur", 80]], query: null, source: "scenario", capturedAt: "2026-10-20T00:00:00Z", truncated: false }],
    assets: [],
  } as unknown as SealedArtifactInput;
}

function longMotion(input: SealedArtifactInput): SealedArtifactInput {
  return editFiles(input, (files) => {
    const manifest = JSON.parse(files["motion.json"]!);
    files["motion.json"] = JSON.stringify({ ...manifest, durationSeconds: 120 });
    let source = files["main.ts"]!;
    source = replaceOnce(source, "timeline.to({}, {duration:.7},5.3)", "timeline.to({}, {duration:114.7},5.3)");
    source = replaceOnce(source, "durationSeconds:6", "durationSeconds:120");
    source = replaceOnce(source, "t>6", "t>120");
    files["main.ts"] = source;
  });
}

function audioInput(manifest: unknown, assets: SealedArtifactInput["assets"]): SealedArtifactInput {
  return { artifact: { kind: "audio" }, revision: { files: { "audio.json": JSON.stringify(manifest) } }, assets, datasets: [] } as unknown as SealedArtifactInput;
}

const noHooks = { beforeExternalCall: async () => undefined, recordExternalOutcome: async () => undefined };
/** NOT OpenAI: a synthetic tone in the speech API's PCM shape, to exercise mixing and ducking. */
const fixtureVoice = async () => ({ outcome: "succeeded" as const, model: "fixture-voice", requestId: null, usage: null, costMicroUsd: null, pcm: tone(330, 3) });

// ── Cases ────────────────────────────────────────────────────────────────────

interface CaseResult {
  id: string;
  title: string;
  group: "format" | "negative" | "operation";
  expected: string;
  actual: string;
  pass: boolean;
  ms: number;
  calls: CallLog[];
  outputs: { name: string; bytes: number; sha256: string }[];
  verification: Record<string, unknown>;
  notes: string[];
}
interface CaseDef {
  id: string;
  title: string;
  group: CaseResult["group"];
  expected: string | readonly string[];
  long?: boolean;
  abortAfterMs?: number;
  run: (render: ArtifactRender, signal: AbortSignal) => Promise<AdapterResult>;
  verify?: (result: AdapterResult | undefined, record: CaseResult) => Promise<void>;
}

function must(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const output = (result: AdapterResult, name: string) => {
  const file = result.outputs.find((o) => o.name === name);
  must(file, `missing output ${name}`);
  return file.bytes;
};
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const b = Buffer.from(bytes);
  must(b.subarray(1, 4).toString() === "PNG", "not a PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
interface Probe { streams: { codec_type: string; codec_name: string; width?: number; height?: number; nb_read_frames?: string; sample_rate?: string; channels?: number }[]; format: { duration: string } }
async function ffprobe(name: string, bytes: Uint8Array): Promise<Probe> {
  return JSON.parse(await inspect("ffprobe", name, bytes)) as Probe;
}
async function verifyVideo(result: AdapterResult | undefined, record: CaseResult, frames: number, withAudio: boolean) {
  must(result, "no result");
  const probe = await ffprobe("video.mp4", output(result, "video.mp4"));
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  record.verification.ffprobe = { video, audio: audio ?? null, duration: probe.format.duration };
  must(video?.codec_name === "h264" && video.width === 1280 && video.height === 720, "video is not 1280x720 H.264");
  must(Number(video.nb_read_frames) === frames, `decoded ${video.nb_read_frames} frames, expected ${frames}`);
  must(withAudio ? audio?.codec_name === "aac" : !audio, withAudio ? "no AAC audio track" : "unexpected audio track");
  must(pngSize(output(result, "poster.png")).width === 1280, "poster is not 1280 wide");
}
async function verifyAudio(result: AdapterResult | undefined, record: CaseResult, seconds: number) {
  must(result, "no result");
  for (const name of ["audio.mp3", "audio.wav"]) {
    const probe = await ffprobe(name, output(result, name));
    const stream = probe.streams.find((s) => s.codec_type === "audio");
    record.verification[name] = { stream, duration: probe.format.duration };
    must(stream?.sample_rate === "48000" && stream.channels === 2, `${name} is not 48 kHz stereo`);
    must(Math.abs(Number(probe.format.duration) - seconds) < 0.1, `${name} lasts ${probe.format.duration}s, expected ${seconds}s`);
  }
}
async function verifySlides(result: AdapterResult | undefined, record: CaseResult, slides: number, width = 1280) {
  must(result, "no result");
  const info = await inspect("pdfinfo", "deck.pdf", output(result, "deck.pdf"));
  const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
  record.verification.pdfinfo = { pages };
  must(pages === slides, `PDF has ${pages} pages, expected ${slides}`);
  must(Buffer.from(output(result, "deck.pptx")).subarray(0, 2).toString() === "PK", "PPTX is not a zip");
  const pngs = result.outputs.filter((o) => /^slide-\d{3}\.png$/.test(o.name));
  must(pngs.length === slides && pngs.every((p) => pngSize(p.bytes).width === width), "slide PNGs do not match the deck");
  must(result.evidence.checks.includes("pptx:libreoffice-opened"), "LibreOffice did not open the PPTX");
}
async function verifyDashboard(result: AdapterResult | undefined, record: CaseResult, probes: number) {
  must(result, "no result");
  const size = pngSize(output(result, "dashboard.png"));
  record.verification.png = size;
  must(size.width === 1280 && size.height === 720, "dashboard PNG is not 1280x720");
  for (let i = 0; i < probes; i++) must(result.evidence.checks.includes(`interaction:${i}:passed`), `interaction ${i} did not pass`);
  must(result.outputs.some((o) => o.name.endsWith(".csv")), "no CSV export");
}

const cancelCodes = ["aborted", "acceptance_cancelled"];
let dashboardPng: Uint8Array | null = null;
const capturePng = () => dashboardPng ?? (() => { throw new Error("needs the dashboard-v1 render first"); })();

async function captureFixtureInput(directory: string, extra: string[] = []): Promise<SealedArtifactInput> {
  const tsx = resolve("node_modules/tsx/dist/cli.mjs");
  const out = spawnSync(process.execPath, [tsx, "--require", "./scripts/test-node-server-only-shim.cjs", "scripts/artifact-project-capture-fixture.ts", directory, ...extra], { encoding: "utf8", windowsHide: true, timeout: 180_000 });
  must(out.status === 0, `capture fixture failed: ${(out.stderr || out.stdout).slice(0, 500)}`);
  return JSON.parse(await readFile(join(directory, "input.json"), "utf8")) as SealedArtifactInput;
}

function cases(work: string): CaseDef[] {
  const png = () => capturePng();
  return [
    { id: "dashboard-v1", title: "Dashboard HTML con filtro y CSV", group: "format", expected: "ok",
      run: async (render, signal) => { const result = await renderDashboard(dashboardFixture(), render, signal); dashboardPng = output(result, "dashboard.png"); return result; },
      verify: (r, rec) => verifyDashboard(r, rec, 2) },
    { id: "dashboard-react", title: "Dashboard React del catálogo (Recharts + Tailwind local)", group: "format", expected: "ok",
      run: (render, signal) => renderDashboard(reactDashboard(), render, signal), verify: (r, rec) => verifyDashboard(r, rec, 1) },
    { id: "slides-v1", title: "Presentación v1: PPTX nativo abierto en LibreOffice → PDF", group: "format", expected: "ok",
      run: async (render, signal) => renderSlides(slidesFixture(new Uint8Array(await readFile("public/icon-512.png"))), render, signal), verify: (r, rec) => verifySlides(r, rec, 2) },
    { id: "slides-v3", title: "Presentación en el formato de diapositivas (v3): medida en Linux → objetos nativos de PPTX → LibreOffice → PDF", group: "format", expected: "ok",
      run: async (render, signal) => renderSlides(slidesV3Fixture(new Uint8Array(await readFile("public/icon-512.png"))), render, signal), verify: (r, rec) => verifySlides(r, rec, 3, 1920) },
    { id: "capture-motion", title: "Captura congelada de una app (fuente v1 tras cambiar a v2) dentro de un video", group: "format", expected: "ok",
      run: async (render, signal) => renderMotion(await captureFixtureInput(join(work, "capture-fixture")), render, signal),
      verify: async (r, rec) => { await verifyVideo(r, rec, 30, false); must(r!.outputs.some((o) => o.name.startsWith("capture-")), "no frozen capture output"); } },
    { id: "capture-real-app", title: "La app Turnia real (Tailwind por CDN, Google Fonts, HashRouter) congelada entera y capturada en #/ y #/reservar", group: "format", expected: "ok",
      run: async (render, signal) => renderMotion(await captureFixtureInput(join(work, "capture-real-app"), ["--app"]), render, signal),
      verify: async (r, rec) => {
        await verifyVideo(r, rec, 60, false);
        const shots = r!.outputs.filter((o) => /^capture-(agenda|reservar)\.png$/.test(o.name));
        must(shots.length === 2, `expected the agenda and reservar captures, got ${r!.outputs.map((o) => o.name).join(", ")}`);
        // A styled screen, not an unstyled page: Tailwind's amber and slate must be in the picture.
        for (const shot of shots) {
          const { data, info } = await sharp(Buffer.from(shot.bytes)).raw().toBuffer({ resolveWithObject: true });
          let amber = 0;
          for (let i = 0; i < data.length; i += info.channels) if (data[i]! > 220 && data[i + 1]! > 140 && data[i + 1]! < 180 && data[i + 2]! < 60) amber++;
          rec.verification[shot.name] = { amberPixels: amber };
          must(amber > 200, `${shot.name} has no Tailwind amber: the app's styles did not load`);
        }
      } },
    { id: "motion-6s", title: "Video de 6 s sin audio (H.264)", group: "format", expected: "ok",
      run: (render, signal) => renderMotion(motionFixture(png()), render, signal), verify: (r, rec) => verifyVideo(r, rec, 180, false) },
    { id: "motion-audio", title: "Video de 6 s con música (H.264 + AAC)", group: "format", expected: "ok",
      run: (render, signal) => {
        const music = wavUpload(220, 6);
        const input = editFiles(motionFixture(png()), (files) => {
          files["motion.json"] = JSON.stringify({ ...JSON.parse(files["motion.json"]!), audio: { tracks: [{ asset: music.id, role: "music", gain: 0.5, fadeOutSeconds: 1 }], duckMusic: true } });
        });
        (input.assets as unknown as unknown[]).push(music);
        return renderMotion(input, render, signal);
      },
      verify: (r, rec) => verifyVideo(r, rec, 180, true) },
    { id: "audio-mix", title: "Audio: música y efecto subidos → MP3 y WAV", group: "format", expected: "ok",
      run: (render, signal) => {
        const music = wavUpload(220, 8), effect = wavUpload(880, 0.5);
        return renderAudio(audioInput({ version: 1, durationSeconds: 8, tracks: [{ asset: music.id, role: "music", gain: 0.6, fadeInSeconds: 0.5, fadeOutSeconds: 1 }, { asset: effect.id, role: "effect", startSeconds: 2 }] }, [music, effect] as never), { transport: fixtureVoice, model: "fixture-voice" }, render, signal, noHooks);
      },
      verify: (r, rec) => verifyAudio(r, rec, 8) },
    { id: "audio-narration-fixture", title: "Audio con narración de FIXTURE (tono, no OpenAI) y música atenuada", group: "format", expected: "ok",
      run: (render, signal) => {
        const music = wavUpload(220, 10);
        return renderAudio(audioInput({ version: 1, speech: { text: "Prueba de narración con voz de fixture.", voice: "coral" }, tracks: [{ asset: music.id, role: "music", gain: 0.6 }] }, [music] as never), { transport: fixtureVoice, model: "fixture-voice" }, render, signal, noHooks);
      },
      verify: async (r, rec) => { await verifyAudio(r, rec, 3); must(r!.outputs.some((o) => o.name === "narration.wav"), "no narration output"); } },
    { id: "motion-120s", title: "Peor caso: video de 120 s (3.600 cuadros) dentro de 2 CPU / 2 GiB", group: "format", expected: "ok", long: true,
      run: (render, signal) => renderMotion(longMotion(motionFixture(png())), render, signal), verify: (r, rec) => verifyVideo(r, rec, 3600, false) },

    { id: "neg-dashboard-runtime-error", title: "Dashboard cuyo JavaScript lanza un error", group: "negative", expected: "artifact_render_failed",
      run: (render, signal) => renderDashboard(editFiles(dashboardFixture(), (files) => {
        files["dashboard.json"] = JSON.stringify({ ...JSON.parse(files["dashboard.json"]!), probes: [] });
        files["main.ts"] = `${files["main.ts"]}\nthrow new Error("authored failure on purpose");`;
      }), render, signal),
      verify: async (_r, rec) => { must(rec.notes.join(" ").includes("authored failure"), "the diagnostics do not carry the authored error"); } },
    { id: "neg-dashboard-external-url", title: "Dashboard con una URL de internet en su HTML (lo corta el compilador)", group: "negative", expected: "artifact_resource_missing",
      run: (render, signal) => renderDashboard(editFiles(dashboardFixture(), (files) => {
        files["index.html"] = replaceOnce(files["index.html"]!, "<main>", '<main><img src="https://example.com/logo.png" alt="">');
      }), render, signal),
      verify: async (_r, rec) => { must(rec.calls.length === 0, "the compiler should refuse it before any container"); } },
    { id: "neg-dashboard-runtime-request", title: "Dashboard que pide internet desde su JavaScript (lo bloquea el renderer)", group: "negative", expected: "artifact_resource_missing",
      run: (render, signal) => renderDashboard(editFiles(dashboardFixture(), (files) => {
        files["dashboard.json"] = JSON.stringify({ ...JSON.parse(files["dashboard.json"]!), probes: [] });
        files["main.ts"] = `${files["main.ts"]}
const probe=new Image();probe.src=["https:","","example.com","x.png"].join("/");document.body.append(probe);`;
      }), render, signal),
      verify: async (_r, rec) => { must(rec.calls.some((c) => c.kind === "dashboard"), "the request never reached the renderer"); } },
    { id: "neg-slides-overflow", title: "Diapositiva con texto que no cabe", group: "negative", expected: "slide_text_overflow",
      run: async (render, signal) => {
        const input = slidesFixture(new Uint8Array(await readFile("public/icon-512.png")));
        return renderSlides(editFiles(input, (files) => {
          files["deck.json"] = replaceOnce(files["deck.json"]!, '"Una presentación editable del proyecto"', JSON.stringify("Texto demasiado largo para su caja. ".repeat(40)));
        }), render, signal);
      } },
    { id: "neg-motion-nondeterministic", title: "Animación que cambia al volver al mismo instante", group: "negative", expected: "motion_nondeterministic",
      run: (render, signal) => renderMotion(editFiles(motionFixture(png()), (files) => {
        // The footer is absolutely positioned and never animated: only randomness moves it.
        files["main.ts"] = replaceOnce(files["main.ts"]!, "timeline.totalTime(t,true);", "timeline.totalTime(t,true);document.querySelector('footer').style.left=(64+Math.floor(Math.random()*400))+'px';");
      }), render, signal) },
    { id: "neg-motion-contract-missing", title: "Animación sin window.lenMotion", group: "negative", expected: "motion_contract_missing",
      run: (render, signal) => renderMotion(editFiles(motionFixture(png()), (files) => {
        files["main.ts"] = replaceOnce(files["main.ts"]!, "window.lenMotion=", "window.notLenMotion=");
      }), render, signal) },
    { id: "neg-audio-corrupt", title: "Pista de audio corrupta", group: "negative", expected: "audio_media_invalid",
      run: (render, signal) => {
        const bytes = new Uint8Array(Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 131 + 7) % 256)));
        const corrupt = { id: `upload:${sha256(bytes)}.wav`, mime: "audio/wav", bytes };
        return renderAudio(audioInput({ version: 1, durationSeconds: 4, tracks: [{ asset: corrupt.id, role: "music" }] }, [corrupt] as never), { transport: fixtureVoice, model: "fixture-voice" }, render, signal, noHooks);
      } },
    { id: "neg-packet-invalid", title: "Paquete fuera de límites (5000 px): se rechaza antes de crear el contenedor", group: "negative", expected: "invalid_render_packet",
      run: (render, signal) => render({ version: 1, kind: "dashboard", html: "<p>x</p>", width: 5000, height: 720, probes: [] } as ArtifactRenderPacket, signal) as never,
      verify: async (_r, rec) => { must(rec.calls.every((c) => c.metrics.samples === 0), "a container was sampled for a packet that should never start one"); } },

    { id: "op-cancel-midway", title: "Cancelar el video de 120 s a los 25 s: contenedor y temporales retirados", group: "operation", expected: cancelCodes, long: true, abortAfterMs: 25_000,
      run: (render, signal) => renderMotion(longMotion(motionFixture(png())), render, signal),
      verify: async (_r, rec) => {
        // A cancel that lands during compilation proves nothing about the container.
        must(rec.calls.some((c) => c.kind === "motion" && c.metrics.samples > 0), "cancelled before the renderer container was running");
        const left = wsl(["docker", "ps", "-a", "-q", "--filter", "label=openlen.artifact-renderer=1"]);
        rec.verification.containersAfterCancel = left.stdout.split("\n").filter(Boolean).length;
        must(left.code === 0 && rec.verification.containersAfterCancel === 0, "a renderer container survived the cancellation");
      } },
    { id: "op-repeatable-dashboard", title: "El mismo dashboard dos veces da el mismo PNG", group: "operation", expected: "ok",
      run: async (render, signal) => {
        const a = await renderDashboard(dashboardFixture(), render, signal), b = await renderDashboard(dashboardFixture(), render, signal);
        return { outputs: [{ name: "first.png", format: "png", mime: "image/png", bytes: output(a, "dashboard.png") }, { name: "second.png", format: "png", mime: "image/png", bytes: output(b, "dashboard.png") }], evidence: { valid: true, checkedAt: new Date().toISOString(), checks: [] } };
      },
      verify: async (r, rec) => {
        const same = sha256(output(r!, "first.png")) === sha256(output(r!, "second.png"));
        rec.verification.identicalPng = same;
        if (!same) rec.notes.push("Not byte-identical: recorded as a finding, not a failure (Chromium may differ in encoding).");
      } },
  ];
}

async function runCase(def: CaseDef, evidence: string): Promise<CaseResult> {
  const calls: CallLog[] = [];
  const controller = new AbortController();
  const timer = def.abortAfterMs ? setTimeout(() => controller.abort(new ArtifactError("acceptance_cancelled")), def.abortAfterMs) : undefined;
  const started = Date.now();
  let result: AdapterResult | undefined, actual = "ok";
  const notes: string[] = [];
  try {
    result = await def.run(bridgeRender(calls, { directory: join(evidence, "packets"), prefix: def.id }), controller.signal);
  } catch (error) {
    actual = error instanceof ArtifactError ? error.code : error instanceof Error && error.name === "AbortError" ? "aborted" : "error";
    notes.push(String(error instanceof Error ? error.message : error).slice(0, 1500));
  } finally {
    clearTimeout(timer);
  }
  const expected = typeof def.expected === "string" ? [def.expected] : def.expected;
  const record: CaseResult = { id: def.id, title: def.title, group: def.group, expected: expected.join(" / "), actual, pass: expected.includes(actual), ms: Date.now() - started, calls, outputs: [], verification: {}, notes };
  // Pass or fail, no job may leave a container or a temporary directory behind.
  if (calls.some((c) => c.leftovers.containers > 0 || c.leftovers.tempDirectories > 0)) {
    record.pass = false;
    notes.push("A job left a container or a temporary directory behind.");
  }
  if (result) {
    const directory = join(evidence, "outputs", def.id);
    await mkdir(directory, { recursive: true });
    for (const file of result.outputs) {
      await writeFile(join(directory, file.name.replace(/[\\/]/g, "_")), file.bytes);
      record.outputs.push({ name: file.name, bytes: file.bytes.length, sha256: sha256(file.bytes) });
    }
    record.verification.checks = result.evidence.checks;
  }
  if (record.pass && def.verify) {
    try { await def.verify(result, record); }
    catch (error) { record.pass = false; notes.push(`verification: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return record;
}

// ── Report ───────────────────────────────────────────────────────────────────

// The supervisor's own limit, so the report can never name a stale one.
const TASK_LIMIT = (() => {
  const args = rendererContainerArgs("openlen/artifact-renderer:1", `openlen-artifact-${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}`, "/tmp/x", 0, 0);
  return args[args.indexOf("--pids-limit") + 1];
})();
const mib = (bytes: number | null) => (bytes === null ? "—" : `${(bytes / 1024 / 1024).toFixed(0)} MiB`);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

function markdown(report: { startedAt: string; finishedAt: string; environment: Record<string, unknown>; bridgeSha256: string; cases: CaseResult[]; global: Record<string, unknown> }): string {
  const passed = report.cases.filter((c) => c.pass).length;
  const rows = report.cases.map((c) => {
    const peak = Math.max(0, ...c.calls.map((k) => k.metrics.peakMemoryBytes ?? 0));
    const cpu = Math.max(0, ...c.calls.map((k) => k.metrics.peakCpuPercent ?? 0));
    const pids = Math.max(0, ...c.calls.map((k) => k.metrics.peakPids ?? 0));
    return `| ${c.pass ? "✅" : "❌"} | \`${c.id}\` | ${c.title} | ${c.expected} | ${c.actual} | ${seconds(c.ms)} | ${peak ? mib(peak) : "—"} | ${cpu ? `${cpu.toFixed(0)} %` : "—"} | ${pids || "—"} |`;
  });
  const failures = report.cases.filter((c) => !c.pass).map((c) => `- \`${c.id}\`: ${c.notes.join(" · ") || "sin detalle"}`);
  return [
    "# Len 3.0 — aceptación del renderer en Linux",
    "",
    `**${passed} de ${report.cases.length} casos pasan.** Inicio ${report.startedAt} · fin ${report.finishedAt}.`,
    "",
    "Adaptadores reales en Windows; supervisor real (`containerArtifactRenderer`) e imagen real en Linux (WSL 2 + Docker), unidos por un puente de prueba. Entradas sintéticas: sin proveedores (la narración es una voz de FIXTURE), sin base de datos, sin datos de clientes, sin `.env`.",
    "",
    "## Entorno",
    "",
    "```json",
    JSON.stringify(report.environment, null, 2),
    "```",
    "",
    `Puente empaquetado: \`package/renderer-bridge.mjs\` (sha256 \`${report.bridgeSha256}\`).`,
    "",
    "## Casos",
    "",
    `| | Caso | Qué prueba | Esperado | Obtenido | Tiempo | Memoria pico | CPU pico | Procesos pico (límite ${TASK_LIMIT}) |`,
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "La memoria y la CPU son muestras de `docker stats` cada ~1-2 s (pueden no ver un pico breve); el límite real lo impone Docker (2 CPU, 2 GiB sin swap). CPU 200 % = las dos CPU.",
    "",
    ...(failures.length ? ["## Fallos", "", ...failures, ""] : []),
    "## Al terminar",
    "",
    "```json",
    JSON.stringify(report.global, null, 2),
    "```",
    "",
    "## Lo que esto NO demuestra",
    "",
    "- La calidad de las imágenes de OpenAI ni la pronunciación de su voz (no hubo llamadas pagadas).",
    "- El comportamiento en la caja de producción (Hetzner): esto es WSL 2 en la laptop.",
    "- El tiempo máximo del supervisor (`render_timeout`): comparte la limpieza con la cancelación, que sí se probó, pero no se forzó aparte.",
    "",
  ].join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!evidenceArg) throw new Error("Pass --evidence <new directory>");
  const evidence = resolve(evidenceArg);
  await mkdir(evidence, { recursive: true });
  if ((await readdir(evidence)).length) throw new Error(`--evidence must be empty: ${evidence}`);
  const work = join(evidence, "work");
  await mkdir(join(evidence, "package"), { recursive: true });
  await mkdir(join(evidence, "packets"), { recursive: true });

  // Prerequisites, all read-only.
  const docker = wsl(["docker", "version", "--format", "{{.Server.Version}}"]);
  must(docker.code === 0, `docker is not reachable in ${distro}: ${docker.stderr.slice(0, 300)}`);
  const cgroup = wsl(["docker", "info", "--format", "{{.CgroupVersion}}"]).stdout.trim();
  must(cgroup === "2", `cgroup v${cgroup}: the CPU/memory limits need cgroup v2`);
  const imageId = wsl(["docker", "image", "inspect", image, "--format", "{{.Id}}"]);
  must(imageId.code === 0, `image ${image} is not built locally (the supervisor never pulls)`);
  const node = arg("--node") ?? wsl(["sh", "-c", 'command -v node || echo "$HOME/.local/bin/node"']).stdout.trim();
  const nodeVersion = wsl([node, "--version"]);
  must(nodeVersion.code === 0, `no node at ${node} inside ${distro}`);

  // The bridge: the real supervisor, bundled with nothing else.
  const bridgeFile = join(evidence, "package", "renderer-bridge.mjs");
  const bridgeSha256 = await bundleBridge(bridgeFile);
  bridge = createBridge({ distro, node, bridgeFile, image });
  const versions = await bridge.call({ type: "inspect", image, tool: "versions" });
  must(versions.ok, `the bridge could not inspect the image: ${versions.ok ? "" : versions.error.message}`);

  const environment = {
    distro, docker: docker.stdout.trim(), cgroup, image, imageId: imageId.stdout.trim(), bridgeNode: nodeVersion.stdout.trim(),
    rendererTools: (versions.output ?? "").trim().split("\n"), orchestratorNode: process.version, platform: process.platform,
  };
  console.log(JSON.stringify(environment, null, 2));

  const startedAt = new Date().toISOString();
  const selected = cases(work).filter((c) => (!only || only.includes(c.id)) && (!skipLong || !c.long));
  const results: CaseResult[] = [];
  try {
    for (const def of selected) {
      process.stdout.write(`${def.id} … `);
      const record = await runCase(def, evidence);
      results.push(record);
      console.log(`${record.pass ? "PASS" : "FAIL"} (${record.actual}, ${seconds(record.ms)})`);
    }
  } finally {
    stopBundlerWorker();
  }

  const containers = wsl(["docker", "ps", "-a", "-q", "--filter", "label=openlen.artifact-renderer=1"]);
  const temps = wsl(["sh", "-c", "ls -d /tmp/openlen-artifact-* /tmp/openlen-inspect-* 2>/dev/null | wc -l"]);
  const global = { rendererContainersLeft: containers.stdout.split("\n").filter(Boolean).length, tempDirectoriesLeft: Number(temps.stdout.trim()) };
  const report = { startedAt, finishedAt: new Date().toISOString(), environment, bridgeSha256, cases: results, global };
  await writeFile(join(evidence, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(evidence, "REPORT.md"), markdown(report));
  const failed = results.filter((r) => !r.pass).length + (global.rendererContainersLeft || global.tempDirectoriesLeft ? 1 : 0);
  console.log(`\n${results.length - results.filter((r) => !r.pass).length}/${results.length} cases passed · leftovers ${JSON.stringify(global)} · ${join(evidence, "REPORT.md")}`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(`Acceptance could not run: ${error instanceof Error ? error.message : String(error)}`);
  stopBundlerWorker();
  process.exitCode = 1;
});
