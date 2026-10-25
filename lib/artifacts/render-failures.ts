// What to do after a failed export (A1 of Len 3.1). Claude Code has no loop
// detector: each tool's error says what to do next («Do not retry the identical
// call…»). Here, for the renderer's failure codes (tools/artifact-renderer/), in
// the words of what each one checks. On 23/10 a video failed as
// motion_nondeterministic with empty diagnostics, and Len rendered the same
// revision again and again.

/** Failures that come from the piece's own sources: rendering the same revision
 *  again gives the same result. The rest (encoder, timeouts, the server) may be
 *  transient and can be queued again (`jobs.ts`, 21/10). */
export const SOURCE_FAILURES: ReadonlySet<string> = new Set([
  "motion_nondeterministic",
  "motion_contract_missing",
  "slide_count_mismatch",
  "slide_text_overflow",
  "slide_element_outside_canvas",
  "slide_layout_unsupported",
  "slide_layout_too_large",
  "audio_narration_overflow",
  "audio_track_timing_invalid",
  "dataset_provenance_missing",
  "artifact_resource_missing",
]);

const WHAT: Readonly<Record<string, string>> = {
  motion_nondeterministic:
    "the video did not look the same when it seeked back to the same instant (the beginning, middle and end are compared byte for byte). Something moves on its own: a CSS animation or transition, a timer or requestAnimationFrame loop, Date.now or Math.random, a <video> or GIF, or an image or font that finishes loading late. Drive everything from the one paused GSAP timeline in lenMotion.seek(), then render the new revision",
  motion_contract_missing:
    "the entry did not define window.lenMotion with ready(), seek() and durationSeconds equal to motion.json's (see /.openlen/docs/artifacts/motion.md); fix it, then render the new revision",
  slide_count_mismatch: "the deck has a different number of slides than it declares; make them match, then render the new revision",
  slide_text_overflow: "text goes outside its box; the diagnostics name the slide: shorten the text or give it room, then render the new revision",
  slide_element_outside_canvas: "an element sits outside the 1920×1080 canvas; the diagnostics name it: move it inside, then render the new revision",
  slide_layout_unsupported: "a slide uses layout the export cannot reproduce; the diagnostics name it: simplify it, then render the new revision",
  slide_layout_too_large: "the slides' layout is too large to export; split or simplify the slides, then render the new revision",
  audio_narration_overflow: "a narration track runs past durationSeconds: start it earlier, shorten it or lengthen the audio, then render the new revision",
  audio_track_timing_invalid: "a track's fades are longer than the time it plays, or it plays for no time; adjust its timing, then render the new revision",
  dataset_provenance_missing: "a dataset has no provenance: say where its numbers come from, then render the new revision",
  artifact_resource_missing: "a file or asset the piece references is missing: check its asset: references against inspect_artifact's assetIds, then render the new revision",
};

const OTHER =
  "if the diagnostics name an error in the sources, fix them and render the new revision; render the same revision again only if it failed for a timeout or the server";

/** One sentence for the model: what the failure means and what to do next. */
export function whatToDoAfter(errorCode: string | null | undefined): string {
  const what = errorCode ? WHAT[errorCode] : undefined;
  return what ? `${what}. Rendering the same revision again gives the same result.` : `${OTHER}.`;
}
