import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildVisualFrameDocument } from "./frame-document";

// jsdom ships without types here (no @types/jsdom): only what these tests use.
type FrameWindow = Window & typeof globalThis;
interface JsdomApi {
  JSDOM: new (
    html: string,
    options: { runScripts: "dangerously"; url: string; pretendToBeVisual: boolean; virtualConsole: unknown },
  ) => { window: FrameWindow };
  VirtualConsole: new () => unknown;
}
const { JSDOM, VirtualConsole } = createRequire(import.meta.url)("jsdom") as JsdomApi;

const APP = "https://openlen.com";

/** The frame document in its own jsdom, with its scripts running. The parent is
 *  the frame's own window (jsdom has no real parent), and what the frame posts
 *  to it is collected in `posted`. */
function frame() {
  const dom = new JSDOM(buildVisualFrameDocument({ parentOrigins: [APP], cspInMeta: false }), {
    runScripts: "dangerously",
    url: "https://lienzo-visuals.openlen.app/",
    pretendToBeVisual: true,
    // The frame's own script errors (one test throws on purpose) stay in the frame.
    virtualConsole: new VirtualConsole(),
  });
  const win = dom.window;
  const posted: { kind: string; [k: string]: unknown }[] = [];
  win.addEventListener("message", (e: MessageEvent) => {
    if (e.data && typeof e.data === "object" && String((e.data as { kind?: unknown }).kind).startsWith("ol-visual:")) {
      const d = e.data as { kind: string };
      if (d.kind !== "ol-visual:render" && d.kind !== "ol-visual:theme") posted.push(d);
    }
  });
  const send = (data: unknown, origin = APP) => win.dispatchEvent(new win.MessageEvent("message", { data, origin, source: win }));
  const root = () => win.document.getElementById("root")!;
  const tick = () => new Promise((r) => setTimeout(r, 30));
  return { win, posted, send, root, tick };
}

describe("the frame runtime", () => {
  it("a partial render cut inside a tag shows the finished part and no raw markup", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:render", code: '<div id="a">uno</div><div class="b', final: false });
    await f.tick();
    expect(f.root().querySelector("#a")?.textContent).toBe("uno");
    expect(f.root().textContent).not.toContain('class="b');
  });

  it("the next partial keeps the same node for the part that didn't change", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:render", code: '<div id="a">uno</div><div class="b', final: false });
    await f.tick();
    const a = f.root().querySelector("#a");
    f.send({ kind: "ol-visual:render", code: '<div id="a">uno</div><div class="b">dos</div>', final: false });
    await f.tick();
    expect(f.root().querySelector("#a")).toBe(a);
    expect(f.root().querySelector(".b")?.textContent).toBe("dos");
  });

  it("scripts don't run while written, run once at the end, and not again", async () => {
    const f = frame();
    const code = "<p>x</p><script>window.runs = (window.runs || 0) + 1</script>";
    f.send({ kind: "ol-visual:render", code, final: false });
    await f.tick();
    expect((f.win as unknown as { runs?: number }).runs).toBeUndefined();
    f.send({ kind: "ol-visual:render", code, final: true });
    await f.tick();
    expect((f.win as unknown as { runs?: number }).runs).toBe(1);
    f.send({ kind: "ol-visual:render", code, final: true });
    await f.tick();
    expect((f.win as unknown as { runs?: number }).runs).toBe(1);
  });

  it("a script that throws doesn't stop the next one, the content stays, and the height is reported", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:render", code: "<p>sigue</p><script>throw new Error('x')</script><script>window.ok = 1</script>", final: true });
    await f.tick();
    expect((f.win as unknown as { ok?: number }).ok).toBe(1);
    expect(f.root().textContent).toContain("sigue");
    expect(f.posted.some((m) => m.kind === "ol-visual:height")).toBe(true);
  });

  it("ignores a message from an origin it doesn't know", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:render", code: "<p>intruso</p>", final: false }, "https://evil.example");
    await f.tick();
    expect(f.root().textContent).not.toContain("intruso");
  });

  it("a link click becomes a message to the chat, and the frame doesn't navigate", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:render", code: '<a id="l" href="https://example.com/x">ver</a>', final: true });
    await f.tick();
    const ev = new f.win.MouseEvent("click", { bubbles: true, cancelable: true });
    f.root().querySelector("#l")!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await f.tick();
    expect(f.posted).toContainEqual({ kind: "ol-visual:link", href: "https://example.com/x" });
  });

  it("sendPrompt and openLink post to the chat", () => {
    const f = frame();
    const w = f.win as unknown as { sendPrompt: (t: string) => void; openLink: (u: string) => void };
    w.sendPrompt("¿y en marzo?");
    w.openLink("https://example.com/y");
    return f.tick().then(() => {
      expect(f.posted).toContainEqual({ kind: "ol-visual:prompt", text: "¿y en marzo?" });
      expect(f.posted).toContainEqual({ kind: "ol-visual:link", href: "https://example.com/y" });
    });
  });

  it("a theme message sets the variables and data-theme on the root", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:theme", theme: "dark", tokens: { "--fg": "#fff", color: "red" } });
    await f.tick();
    const html = f.win.document.documentElement;
    expect(html.getAttribute("data-theme")).toBe("dark");
    expect(html.style.getPropertyValue("--fg")).toBe("#fff");
    expect(html.style.getPropertyValue("color")).toBe("");
  });

  it("a theme change after the final render runs the visual again, so a canvas picks up the new colors", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:theme", theme: "dark", tokens: { "--fg": "#fff" } });
    const code =
      '<p id="p">x</p><script>(window.seen = window.seen || []).push(getComputedStyle(document.documentElement).getPropertyValue("--fg").trim())</script>';
    f.send({ kind: "ol-visual:render", code, final: true });
    await f.tick();
    f.send({ kind: "ol-visual:theme", theme: "light", tokens: { "--fg": "#111" } });
    await f.tick();
    expect((f.win as unknown as { seen?: string[] }).seen).toEqual(["#fff", "#111"]);
    expect(f.root().querySelectorAll("#p")).toHaveLength(1);
  });

  it("a theme change before the final render only sets the variables", async () => {
    const f = frame();
    f.send({ kind: "ol-visual:render", code: "<p>x</p><script>window.runs = (window.runs || 0) + 1</script>", final: false });
    f.send({ kind: "ol-visual:theme", theme: "light", tokens: { "--fg": "#111" } });
    await f.tick();
    expect((f.win as unknown as { runs?: number }).runs).toBeUndefined();
  });

  it("tells the chat it is ready", async () => {
    const f = frame();
    await f.tick();
    expect(f.posted).toContainEqual({ kind: "ol-visual:ready" });
  });
});
