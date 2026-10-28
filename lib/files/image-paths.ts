// Where a file uploaded from the image modal goes in the project's folder (spec local
// 2026-10-28-ficheros-al-nivel-de-claude-code, §6): an image to /img, a video to /video…, named like the original
// (lower case, no accents, dashes) with -2, -3 when taken. Pure: the modal imports it.

/** The folder of each kind of media. */
export function folderFor(mime: string): string {
  if (mime.startsWith("image/")) return "/img";
  if (mime.startsWith("video/")) return "/video";
  if (mime.startsWith("audio/")) return "/audio";
  if (mime.startsWith("font/")) return "/fonts";
  return "/files";
}

export function imagePathFor(originalName: string, existing: ReadonlySet<string>, ext: string, dir = "/img"): string {
  const sinExtension = originalName.replace(/\.[^.]*$/, "");
  const base =
    sinExtension
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "imagen";
  for (let n = 1; ; n++) {
    const ruta = `${dir}/${base}${n === 1 ? "" : `-${n}`}.${ext}`;
    if (!existing.has(ruta)) return ruta;
  }
}

/** Where the modal uploads: the folder's upload route, optimizing images as the modal always did. */
export function uploadEndpointFor(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/ficheros/upload?optimize=image`;
}
