import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const execute = promisify(execFile);
export async function openNativeSlides(packet) {
  await mkdir("/tmp/office", { recursive: true });
  await writeFile("/tmp/deck.pptx", Buffer.from(packet.nativePptxBase64, "base64"), { flag: "wx" });
  const options = { timeout: 90_000, maxBuffer: 256 * 1024, env: { ...process.env, LC_ALL: "C", LANG: "C" } };
  await execute("soffice", ["-env:UserInstallation=file:///tmp/lo-profile", "--headless", "--convert-to", "pdf", "--outdir", "/tmp/office", "/tmp/deck.pptx"], options);
  const { stdout } = await execute("pdfinfo", ["/tmp/office/deck.pdf"], options);
  if (Number(/^Pages:\s*(\d+)$/m.exec(stdout)?.[1]) !== packet.pageCount) throw new Error("slide_count_mismatch");
  await execute("pdftoppm", ["-png", "-scale-to-x", String(packet.width), "-scale-to-y", String(packet.height), "/tmp/office/deck.pdf", "/tmp/office/slide"], options);
  const pages = [];
  const digits = String(packet.pageCount).length;
  for (let i = 1; i <= packet.pageCount; i++) pages.push(new Uint8Array(await readFile(`/tmp/office/slide-${String(i).padStart(digits, "0")}.png`)));
  return { pdf: new Uint8Array(await readFile("/tmp/office/deck.pdf")), pages };
}
