// LOS BINARIOS Y LAS HERRAMIENTAS DE LEN (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, §5), como las
// de Claude Code: Read enseña una imagen o un PDF (eso lo hace herramientas-de-ficheros.ts con sus bytes), lee un
// texto que no es UTF-8 con U+FFFD y una nota, y dice que no puede con un binario; Edit y Write no tocan un
// fichero que no es UTF-8. Los textos son los del arnés de Claude Code, provocados el 2026-10-28 (Read de un
// .bin y de un Latin-1; Edit y Write sobre ellos). Sólo se quitó del consejo «or PowerShell
// Get-Content/Set-Content -Encoding»: lo dice en Windows, y la terminal de Len es Linux.
// Puro: lo prueba vitest sin base ni almacén.

const NOT_UTF8_NOTE =
  "[This file is not valid UTF-8: it uses a legacy encoding such as Windows-1252, Shift-JIS or GBK, or it is binary. Its undecodable bytes show above as U+FFFD. Edit and Write will refuse it: change it with a shell command that keeps its encoding, or ask the user whether to convert it to UTF-8.]";

const WRITE_ADVICE =
  "These tools write UTF-8 (or UTF-16LE behind its byte-order mark) and never convert a file's encoding on their own, so nothing was written. If the file is text, make the change with a shell command that reads and writes it in its own encoding (iconv), or ask the user whether to convert it to UTF-8 first. To replace the whole file with new UTF-8 text anyway, delete it first, then Write it.";

function extensionOf(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return punto > 0 ? nombre.slice(punto).toLowerCase() : "";
}

export function binaryReadError(ruta: string): string {
  const ext = extensionOf(ruta);
  return `This tool cannot read binary files. The file appears to be a binary ${ext ? `${ext} ` : ""}file. Use a skill for this file type if one is available, or a shell command or script that can read the format.`;
}

const hasNul = (bytes: Uint8Array) => bytes.subarray(0, 8000).includes(0);
const isUtf16LeBom = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xfe;

/** What Read makes of a blob that is not an image or a PDF. */
export function readOfBytes(bytes: Uint8Array): { kind: "text"; text: string; note?: string } | { kind: "binary" } {
  if (isUtf16LeBom(bytes)) return { kind: "text", text: new TextDecoder("utf-16le").decode(bytes.subarray(2)) };
  if (hasNul(bytes)) return { kind: "binary" };
  return { kind: "text", text: new TextDecoder("utf-8").decode(bytes), note: NOT_UTF8_NOTE };
}

/** Why Edit and Write leave a file that is not UTF-8 alone. */
export function encodingWriteError(bytes: Uint8Array): string {
  return hasNul(bytes)
    ? `File has NUL bytes in its first 8 KB: binary data, UTF-16/UTF-32 without a byte-order mark, or text with embedded NULs. ${WRITE_ADVICE}`
    : `File is not valid UTF-8: it uses a legacy encoding such as Windows-1252, Shift-JIS or GBK, or it is binary. ${WRITE_ADVICE}`;
}
