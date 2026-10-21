import "@inariwatch/capture/auto";
import { writeFile } from "node:fs/promises";
import { renderDashboardPacket, renderSlidesPacket, renderMotionPacket,renderProjectCapturePacket,renderSlideLayoutPacket } from "./browser.mjs";
import { openNativeSlides } from "./office.mjs";
import { createMotionEncoder } from "./video.mjs";
import {mixAudioTracks,validateAudioEnvelope} from "./audio.mjs";

// A bounded JSON envelope on stdin; no secrets or database configuration.
let input = "";
try {
  for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 100 * 1024 * 1024) throw new Error("render_input_too_large"); }
  const packet = JSON.parse(input);
  if (packet.version !== 1 || !["dashboard", "slides", "slides-layout","motion","capture","audio"].includes(packet.kind) || typeof packet.html !== "string" || Buffer.byteLength(packet.html)>8*1024*1024 || !Number.isInteger(packet.width) || packet.width < 320 || packet.width > 1920 || !Number.isInteger(packet.height) || packet.height < 240 || packet.height > 1080 || !Array.isArray(packet.probes) || packet.probes.length > 20) throw new Error("invalid_render_packet");
  if(packet.kind==="audio"||packet.kind==="motion"&&packet.audio){validateAudioEnvelope(packet.audio);if(packet.kind==="audio"&&(packet.html!==""||packet.probes.length)||packet.kind==="motion"&&Math.abs(packet.audio.durationSeconds-packet.durationSeconds)>1e-6)throw Error("invalid_audio_packet");}
  if(packet.kind==="slides-layout"&&(!Number.isInteger(packet.pageCount)||packet.pageCount<1||packet.pageCount>50||packet.probes.length))throw new Error("invalid_render_packet");
  if(packet.kind==="capture"&&(packet.width!==1280||packet.height!==720||packet.probes.length||(packet.route!==undefined&&(typeof packet.route!=="string"||!/^#\/[A-Za-z0-9\/_.~%-]{0,200}$/.test(packet.route)))))throw new Error("invalid_render_packet");
  if(packet.kind!=="capture"&&packet.route!==undefined)throw new Error("invalid_render_packet");
  if (packet.kind === "slides" && (!Number.isInteger(packet.pageCount) || packet.pageCount < 1 || packet.pageCount > 50 || typeof packet.nativePptxBase64 !== "string" || packet.nativePptxBase64.length > 10 * 1024 * 1024)) throw new Error("invalid_render_packet");
  const options = { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH };
  let result;
  if(packet.kind==="audio"){
    result={checks:["audio:decoded","audio:duration-checked","audio:stereo-48000","audio:mp3-wav"],audio:await mixAudioTracks(packet.audio)};
  }else if(packet.kind==="motion"){
    if(packet.fps!==30||packet.width!==1280||packet.height!==720||!Number.isFinite(packet.durationSeconds)||packet.durationSeconds<1||packet.durationSeconds>120||!Number.isInteger(packet.frameCount)||packet.frameCount!==Math.round(packet.durationSeconds*30)||Math.abs(packet.frameCount-packet.durationSeconds*30)>1e-6)throw new Error("invalid_render_packet");
    const encoder=createMotionEncoder(packet);
    try{
      result=await renderMotionPacket(packet,(bytes,index)=>encoder.write(bytes,index),options);
      result.video=await encoder.finish();
      result.checks.push("video:h264",...packet.audio?["video:aac-audio","audio:decoded","audio:duration-checked"]:["video:no-audio"],"video:decoded","video:frame-count-checked");
    }finally{encoder.abort();}
  }else result=await(packet.kind==="slides-layout"?renderSlideLayoutPacket(packet,options):packet.kind==="slides"?renderSlidesPacket(packet,options):packet.kind==="capture"?renderProjectCapturePacket(packet,options):renderDashboardPacket(packet,options));
  if(packet.kind==="slides-layout"){
    const json=JSON.stringify(result.layout);if(Buffer.byteLength(json)>16*1024*1024)throw new Error("slide_layout_too_large");
    await writeFile("/output/layout.json",json,{flag:"wx"});
  }
  if (packet.kind === "slides") {
    const native = await openNativeSlides(packet);
    result.pages = native.pages; result.png = native.pages[0];
    await writeFile("/output/render.pdf", native.pdf, { flag: "wx" });
    for (const [index, page] of native.pages.entries()) await writeFile(`/output/page-${index + 1}.png`, page, { flag: "wx" });
    result.checks.push("pptx:libreoffice-opened", "pdf:page-count-checked", "native-slides:rasterized");
  }
  if(packet.kind!=="audio")await writeFile("/output/render.png", result.png, { flag: "wx" });
  await writeFile("/output/result.json", JSON.stringify({ ok: true, checks: result.checks, ...(result.video?{video:result.video}:{}),...result.audio?{audio:result.audio}:{} }), { flag: "wx" });
} catch (error) {
  const allowed = ["invalid_audio_packet","audio_media_invalid","audio_track_timing_invalid","audio_narration_overflow","audio_export_invalid","motion_audio_invalid","render_input_too_large", "invalid_render_packet", "dataset_provenance_missing", "dashboard_output_invalid", "artifact_resource_missing", "artifact_runtime_error", "slide_text_overflow", "slide_count_mismatch","slide_layout_unsupported","slide_layout_too_large","slide_element_outside_canvas", "motion_contract_missing", "motion_nondeterministic", "motion_video_invalid", "motion_frame_count_mismatch"];
  const reason=String(error?.message??"").split(":")[0],code = allowed.includes(reason) ? reason : "render_failed";
  await writeFile("/output/result.json", JSON.stringify({ ok: false, code, diagnostics: Array.isArray(error?.cause) ? error.cause.slice(0, 8) : [String(error?.message??"").slice(0,1000)] }), { flag: "wx" }).catch(() => undefined);
  process.exitCode = 1;
}
