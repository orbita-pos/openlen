// Share and Open with for a delivered file on the phone (spec local 2026-10-31-len-movil, §5.1): the
// bytes, fetched with the phone's key, go to the app's cache folder, and Android shares them or opens
// them with another app (Google Slides, a PDF reader…). The cache is the system's to clear.
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { FileOpener } from "@capacitor-community/file-opener";

import { contentTypeOf } from "@/lib/agent/skills/present";

export interface FileForActions {
  readonly name: string;
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** A name the file system takes, keeping the extension Android uses to pick an app. */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120) || "file";
}

async function toCache(file: FileForActions, blob: Blob): Promise<string> {
  const written = await Filesystem.writeFile({ path: `delivered/${safeName(file.name)}`, data: await base64Of(blob), directory: Directory.Cache, recursive: true });
  return written.uri;
}

export async function shareFile(file: FileForActions, blob: Blob): Promise<void> {
  await Share.share({ title: file.name, files: [await toCache(file, blob)] });
}

export async function openWith(file: FileForActions, blob: Blob): Promise<void> {
  await FileOpener.open({ filePath: await toCache(file, blob), contentType: blob.type || contentTypeOf(file.name), openWithDefault: false });
}
