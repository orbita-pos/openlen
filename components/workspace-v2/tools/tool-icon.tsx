// A TOOL'S ICON IN OPENLEN'S CHROME (spec local 2026-11-04-herramientas-hechas-por-len, §4.3). An SVG the tool drew
// in currentColor is black inside an <img> (it can't inherit a colour from the page), so on the dark rail it
// disappeared. An SVG is painted as a mask in the colour around it — the rail's, light or dark; a raster icon (PNG,
// JPEG, WebP) is shown as it is. The SVG is never inlined: it is the tool's, and openlen.com doesn't run it.
export function ToolIcon({ url, tinted, size, className }: { url: string; tinted: boolean; size: number; className?: string }) {
  if (!tinted) return <img src={url} alt="" width={size} height={size} className={className} />;
  const mask = `url("${url}") center / contain no-repeat`;
  return (
    <span
      data-tool-icon={url}
      aria-hidden
      className={className}
      style={{ display: "inline-block", width: size, height: size, backgroundColor: "currentColor", mask, WebkitMask: mask }}
    />
  );
}
