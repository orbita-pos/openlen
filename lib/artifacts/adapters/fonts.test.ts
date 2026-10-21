// @vitest-environment node
import { expect, it } from "vitest";
import { resolveRemoteFonts } from "./fonts";

const SHELL = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>body{font-family:"Inter",system-ui,sans-serif}</style>
</head><body></body></html>`;
const noFetch = async () => { throw new Error("no network expected"); };

it("drops a Google Fonts link whose families the renderer has installed, and the preconnects with it", async () => {
  const html = await resolveRemoteFonts(SHELL, noFetch);
  expect(html).not.toContain("fonts.googleapis.com");
  expect(html).not.toContain("fonts.gstatic.com");
  expect(html).toContain('body{font-family:"Inter"');
});

it("embeds a family the renderer does not have, fetched only from Google's font hosts", async () => {
  const urls: string[] = [];
  const fetchImpl = async (url: string) => {
    urls.push(url);
    if (url.startsWith("https://fonts.googleapis.com/css2?")) return new Response(`/* cyrillic */\n@font-face{font-family:'Playfair Display';src:url(https://fonts.gstatic.com/s/p/cyr.woff2) format('woff2');unicode-range:U+0400-045F}\n/* latin */\n@font-face{font-family:'Playfair Display';font-weight:700;src:url(https://fonts.gstatic.com/s/p/latin.woff2) format('woff2');unicode-range:U+0000-00FF}`, { headers: { "content-type": "text/css" } });
    if (url === "https://fonts.gstatic.com/s/p/latin.woff2") return new Response(new Uint8Array([119, 79, 70, 50, 1, 2, 3]));
    return new Response("not found", { status: 404 });
  };
  const html = await resolveRemoteFonts(SHELL.replace("family=Inter:wght@400;500;600;700", "family=Playfair+Display:wght@700"), fetchImpl);
  expect(urls).toEqual(["https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap", "https://fonts.gstatic.com/s/p/latin.woff2"]);
  expect(html).toContain("@font-face{font-family:'Playfair Display';font-weight:700;src:url(data:font/woff2;base64,d09GMgECAw==) format('woff2')");
  expect(html).not.toContain("cyr.woff2");
  expect(html).not.toMatch(/<link[^>]+fonts\.googleapis/);
});

it("says which family could not be had, and which ones the renderer has", async () => {
  await expect(resolveRemoteFonts(SHELL.replace("family=Inter", "family=Playfair+Display"), async () => new Response("", { status: 500 })))
    .rejects.toMatchObject({ code: "artifact_resource_missing", message: expect.stringMatching(/Playfair Display.*could not be fetched.*Inter, Roboto/) });
});

it("leaves a page without remote fonts alone", async () => {
  const page = "<html><head><style>body{font-family:Arial}</style></head><body><p>Hola</p></body></html>";
  expect(await resolveRemoteFonts(page, noFetch)).toBe(page);
});
