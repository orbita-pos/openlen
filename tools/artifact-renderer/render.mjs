import "@inariwatch/capture/auto";
import { writeFile } from "node:fs/promises";
import { renderDashboardPacket } from "./browser.mjs";

// A bounded JSON envelope on stdin; no secrets or database configuration.
let input = "";
try {
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 10 * 1024 * 1024) throw new Error("render_input_too_large"); }
  const packet = JSON.parse(input);
  if (packet.version !== 1 || packet.kind !== "dashboard" || typeof packet.html !== "string" || !Number.isInteger(packet.width) || packet.width < 320 || packet.width > 1920 || !Number.isInteger(packet.height) || packet.height < 240 || packet.height > 1080 || !Array.isArray(packet.probes) || packet.probes.length > 20) throw new Error("invalid_render_packet");
  const result = await renderDashboardPacket(packet, { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH });
  await writeFile("/output/render.png", result.png, { flag: "wx" });
  await writeFile("/output/result.json", JSON.stringify({ ok: true, checks: result.checks }), { flag: "wx" });
} catch (error) {
  const allowed = ["render_input_too_large", "invalid_render_packet", "dataset_provenance_missing", "artifact_resource_missing", "artifact_runtime_error"];
  const code = allowed.includes(error?.message) ? error.message : "render_failed";
  await writeFile("/output/result.json", JSON.stringify({ ok: false, code, diagnostics: Array.isArray(error?.cause) ? error.cause.slice(0, 8) : [] }), { flag: "wx" }).catch(() => undefined);
  process.exitCode = 1;
}
