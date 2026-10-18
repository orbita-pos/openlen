import "@inariwatch/capture/auto";
import { writeFile } from "node:fs/promises";
import { renderDashboardPacket, renderSlidesPacket, renderMotionPacket } from "./browser.mjs";
import { openNativeSlides } from "./office.mjs";
import { createMotionEncoder } from "./video.mjs";

// A bounded JSON envelope on stdin; no secrets or database configuration.
let input = "";
try {
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 20 * 1024 * 1024) throw new Error("render_input_too_large"); }
  const packet = JSON.parse(input);
  if (packet.version !== 1 || !["dashboard", "slides", "motion"].includes(packet.kind) || typeof packet.html !== "string" || !Number.isInteger(packet.width) || packet.width < 320 || packet.width > 1920 || !Number.isInteger(packet.height) || packet.height < 240 || packet.height > 1080 || !Array.isArray(packet.probes) || packet.probes.length > 20) throw new Error("invalid_render_packet");
  if (packet.kind === "slides" && (!Number.isInteger(packet.pageCount) || packet.pageCount < 1 || packet.pageCount > 50 || typeof packet.nativePptxBase64 !== "string" || packet.nativePptxBase64.length > 10 * 1024 * 1024)) throw new Error("invalid_render_packet");
  const options = { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH };
  let result;
  if(packet.kind==="motion"){
    if(packet.fps!==30||packet.width!==1280||packet.height!==720||!Number.isFinite(packet.durationSeconds)||packet.durationSeconds<1||packet.durationSeconds>120||!Number.isInteger(packet.frameCount)||packet.frameCount!==Math.round(packet.durationSeconds*30)||Math.abs(packet.frameCount-packet.durationSeconds*30)>1e-6)throw new Error("invalid_render_packet");
    const encoder=createMotionEncoder(packet);
    try{
      result=await renderMotionPacket(packet,(bytes,index)=>encoder.write(bytes,index),options);
      result.video=await encoder.finish();
      result.checks.push("video:h264","video:no-audio","video:decoded","video:frame-count-checked");
    }finally{encoder.abort();}
  }else result=await(packet.kind==="slides"?renderSlidesPacket(packet,options):renderDashboardPacket(packet,options));
  if (packet.kind === "slides") {
    const native = await openNativeSlides(packet);
    result.pages = native.pages; result.png = native.pages[0];
    await writeFile("/output/render.pdf", native.pdf, { flag: "wx" });
    for (const [index, page] of native.pages.entries()) await writeFile(`/output/page-${index + 1}.png`, page, { flag: "wx" });
    result.checks.push("pptx:libreoffice-opened", "pdf:page-count-checked", "native-slides:rasterized");
  }
  await writeFile("/output/render.png", result.png, { flag: "wx" });
  await writeFile("/output/result.json", JSON.stringify({ ok: true, checks: result.checks, ...(result.video?{video:result.video}:{}) }), { flag: "wx" });
} catch (error) {
  const allowed = ["render_input_too_large", "invalid_render_packet", "dataset_provenance_missing", "artifact_resource_missing", "artifact_runtime_error", "slide_text_overflow", "slide_count_mismatch", "motion_contract_missing", "motion_nondeterministic", "motion_video_invalid", "motion_frame_count_mismatch"];
  const code = allowed.includes(error?.message) ? error.message : "render_failed";
  await writeFile("/output/result.json", JSON.stringify({ ok: false, code, diagnostics: Array.isArray(error?.cause) ? error.cause.slice(0, 8) : [] }), { flag: "wx" }).catch(() => undefined);
  process.exitCode = 1;
}
