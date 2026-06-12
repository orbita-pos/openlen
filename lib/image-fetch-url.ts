// Resolve an image URL to something a canvas can read pixels from: data: and
// same-origin URLs go direct; cross-origin (R2 / Unsplash send no CORS) goes
// through the project's SSRF-guarded proxy-image route. Extracted from the
// inspector's logo flow so the drop engine's luminance derivation shares it.
// Client-safe: no node imports.
export function imageFetchUrl(url: string, projectId?: string | null): string {
  if (url.startsWith("data:") || url.startsWith("/")) return url;
  try {
    if (new URL(url).origin === window.location.origin) return url;
  } catch {
    return url;
  }
  return projectId
    ? `/api/projects/${projectId}/proxy-image?url=${encodeURIComponent(url)}`
    : url;
}
