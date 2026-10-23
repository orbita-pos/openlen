export const RENDER_FRAME = { width: { min: 320, max: 1920 }, height: { min: 240, max: 1080 } } as const;
export interface ArtifactPreviewFrame {readonly width:number;readonly height:number}
/** Only bounded renderer dimensions may become iframe styles. No source HTML crosses into the app. */
export function previewFrame(value:unknown):ArtifactPreviewFrame|undefined{
  if(!value||typeof value!=="object")return;
  const {width,height}=value as ArtifactPreviewFrame;
  if(!Number.isSafeInteger(width)||width<RENDER_FRAME.width.min||width>RENDER_FRAME.width.max||!Number.isSafeInteger(height)||height<RENDER_FRAME.height.min||height>RENDER_FRAME.height.max)return;
  return {width,height};
}
