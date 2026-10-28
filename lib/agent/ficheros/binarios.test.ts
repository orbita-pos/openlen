// Binary files and Len's file tools, like Claude Code's (spec local 2026-10-28-ficheros-al-nivel-de-claude-code,
// §5). The texts are Claude Code's own, provoked in its harness on 2026-10-28 (see binarios.ts).
import { describe, expect, it } from "vitest";

import { makePointer } from "@/lib/files/blob-pointer";

import { binaryReadError, encodingWriteError, readOfBytes } from "./binarios";
import { ejecutarGrep } from "./grep";

describe("Read of bytes that aren't UTF-8 text", () => {
  it("a binary: Claude Code's error, naming its extension", () => {
    expect(binaryReadError("/data/x.bin")).toBe(
      "This tool cannot read binary files. The file appears to be a binary .bin file. Use a skill for this file type if one is available, or a shell command or script that can read the format.",
    );
    expect(binaryReadError("/Makefile.out")).toContain("a binary .out file");
    expect(binaryReadError("/sin-extension")).toContain("The file appears to be a binary file.");
  });

  it("legacy-encoded text (Latin-1): its text with U+FFFD and Claude Code's note", () => {
    const r = readOfBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
    expect(r).toEqual({
      kind: "text",
      text: "caf�\n",
      note: "[This file is not valid UTF-8: it uses a legacy encoding such as Windows-1252, Shift-JIS or GBK, or it is binary. Its undecodable bytes show above as U+FFFD. Edit and Write will refuse it: change it with a shell command that keeps its encoding, or ask the user whether to convert it to UTF-8.]",
    });
  });

  it("UTF-16LE behind its byte-order mark is plain text, as Claude Code reads it", () => {
    const bytes = Uint8Array.from([0xff, 0xfe, 0x68, 0x00, 0x6f, 0x00, 0x6c, 0x00, 0x61, 0x00]);
    expect(readOfBytes(bytes)).toEqual({ kind: "text", text: "hola" });
  });

  it("bytes with NULs and no byte-order mark are binary", () => {
    expect(readOfBytes(Uint8Array.from([0x00, 0x01, 0x02]))).toEqual({ kind: "binary" });
  });
});

describe("Edit and Write on a file that isn't UTF-8", () => {
  const RESTO =
    "These tools write UTF-8 (or UTF-16LE behind its byte-order mark) and never convert a file's encoding on their own, so nothing was written. If the file is text, make the change with a shell command that reads and writes it in its own encoding (iconv), or ask the user whether to convert it to UTF-8 first. To replace the whole file with new UTF-8 text anyway, delete it first, then Write it.";

  it("NULs in the first 8 KB", () => {
    expect(encodingWriteError(Uint8Array.from([0x89, 0x50, 0x00]))).toBe(
      `File has NUL bytes in its first 8 KB: binary data, UTF-16/UTF-32 without a byte-order mark, or text with embedded NULs. ${RESTO}`,
    );
  });

  it("not valid UTF-8", () => {
    expect(encodingWriteError(Uint8Array.from([0x63, 0xe9]))).toBe(
      `File is not valid UTF-8: it uses a legacy encoding such as Windows-1252, Shift-JIS or GBK, or it is binary. ${RESTO}`,
    );
  });
});

describe("Grep skips binary files, like ripgrep", () => {
  it("a pointer is never searched", () => {
    const puntero = makePointer({ sha256: "a".repeat(64), size: 3, gitOid: "b".repeat(40) });
    const files: Record<string, string> = { "/a.txt": "openlen\n", "/img/a.png": puntero };
    const r = ejecutarGrep({ pattern: "openlen", output_mode: "files_with_matches" }, { ficheros: Object.keys(files), contenido: (ruta) => files[ruta] ?? null });
    expect(r.texto).toContain("a.txt");
    expect(r.texto).not.toContain("a.png");
  });
});
