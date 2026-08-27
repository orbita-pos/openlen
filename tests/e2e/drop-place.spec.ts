// Drop engine — e2e on the inline-edit harness pattern: inject the REAL
// runtimes (drop-place + section-insert + element-inspect) into a fixture
// page, host it in an iframe, and simulate the production parent. Exercises
// genuine DragEvent/DataTransfer mechanics in a real browser with no Next
// app / DB dependency.
//
// Deliberately runs with editMode:false + dropEnabled:true — the drop engine
// must work with the TopBar edit toggle OFF (the design decision), and the
// co-injected inspect script must stay inert.

import { test, expect, type Page, type Frame } from "@playwright/test";
import { injectDropPlace } from "../../components/workspace-v2/use-drop-place";
import { injectImageReplace } from "../../components/workspace-v2/use-image-replace";
import { injectSectionReorder } from "../../components/workspace-v2/use-section-reorder";
import { injectSectionInsert } from "../../components/workspace-v2/use-section-insert";
import { injectElementInspect } from "../../components/workspace-v2/use-element-inspect";
import { injectInlineEdit } from "../../components/workspace-v2/use-inline-edit";

const SAMPLE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; background: #fff; color: #111; }
</style></head>
<body>
  <nav id="topnav" style="height:80px;background:#eee">nav</nav>
  <section id="s1" style="height:300px;background:#ddd">
    <h2 style="margin:0;padding:16px">Section one</h2>
    <img id="pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width:200px;height:120px;display:block;margin:24px" alt="">
  </section>
  <section id="s2" style="height:300px;background:#fff">
    <h2 id="s2-light" style="color:#ffffff;margin:0;padding:12px">Light heading</h2>
    <p id="s2-dark" style="color:#111111;margin:0;padding:12px">Dark paragraph</p>
  </section>
  <footer id="foot" style="height:120px;background:#eee">footer
    <img id="pic2" src="/qa-two.webp" alt="second image" style="width:120px;height:70px;display:block">
  </footer>
</body></html>`;

// inline-edit must ride along: its bootstrap is what posts iframe-ready (the
// signal the parent bridge answers with set-mode). With editMode:false it
// stays otherwise inert — same as production. Replace + Reorder ride too
// (hover pill + trash + section toolbar live there), injected in production's
// derive() order: Replace → Reorder → Inspect → InlineEdit → Insert → Drop.
const AUGMENTED = injectDropPlace(
  injectSectionInsert(
    injectInlineEdit(
      injectElementInspect(injectSectionReorder(injectImageReplace(SAMPLE))),
    ),
  ),
  {
    replace: "Replace image",
    newSection: "New section",
    background: "Section background",
    splitLeft: "Image on the left",
    splitRight: "Image on the right",
    swap: "Swap images",
  },
);

type Win = Window & { __msgs?: Array<Record<string, unknown>> };

type DropState = {
  active: string | null;
  line: boolean;
  tint: boolean;
  chip: string | null;
  target: string | null;
};
type DropDriver = {
  dragAt: (x: number, y: number, textOnly?: boolean) => Promise<DropState>;
  dropAt: (x: number, y: number) => Promise<DropState>;
  dragAssetAt: (x: number, y: number, json: string) => Promise<DropState>;
  dropAssetAt: (x: number, y: number, json: string) => Promise<DropState>;
  swapDrag: (fromSel: string, toSel: string) => Promise<DropState>;
  moveAt: (x: number, y: number) => Promise<DropState>;
  clickAt: (x: number, y: number) => void;
  escape: () => void;
  center: (sel: string) => { x: number; y: number };
  state: () => DropState;
};
type DriverWin = Window & { __drop: DropDriver };

async function setup(page: Page): Promise<Frame> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"></head>
     <body style="margin:0">
       <iframe id="f" sandbox="allow-scripts allow-same-origin"
               style="width:1000px;height:740px;border:0;display:block"></iframe>
       <script>
         window.__msgs = [];
         window.addEventListener('message', function (e) {
           if (!e.data || typeof e.data !== 'object') return;
           window.__msgs.push(e.data);
           if (e.data.type === 'openlen:iframe-ready') {
             document.getElementById('f').contentWindow.postMessage(
               { type: 'openlen:set-mode', editMode: false, selectMode: false, dropEnabled: true }, '*');
           }
         });
       </script>
     </body></html>`,
  );
  await page.evaluate(
    (html) =>
      new Promise<void>((resolve) => {
        const f = document.getElementById("f") as HTMLIFrameElement;
        f.addEventListener("load", () => resolve(), { once: true });
        f.srcdoc = html;
      }),
    AUGMENTED,
  );
  const frame = page.mainFrame().childFrames()[0];
  // Install the test driver: dispatch + double-rAF (the hit-test is rAF
  // throttled) + state read, atomically per call so the 500ms drag watchdog
  // can't race a slow poll.
  await frame.evaluate(() => {
    const settle = () =>
      new Promise<void>((res) =>
        requestAnimationFrame(() => requestAnimationFrame(() => res())),
      );
    const fileDT = () => {
      const dt = new DataTransfer();
      dt.items.add(new File(["x"], "team-photo_v2.png", { type: "image/png" }));
      return dt;
    };
    const state = () => {
      const vis = (sel: string, mode: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        return !!el && el.style.display === mode;
      };
      const chip = document.querySelector(
        ".openlen-drop-chip",
      ) as HTMLElement | null;
      const target = document.querySelector("[data-openlen-drop-target]");
      return {
        active: document.body.getAttribute("data-openlen-drop-active"),
        line: vis(".openlen-drop-line", "block"),
        tint: vis(".openlen-drop-overlay", "block"),
        chip:
          chip && chip.style.display === "inline-flex"
            ? chip.textContent
            : null,
        target: target ? target.id || target.tagName : null,
      };
    };
    (window as unknown as DriverWin).__drop = {
      async dragAt(x: number, y: number, textOnly?: boolean) {
        const dt = textOnly ? new DataTransfer() : fileDT();
        if (textOnly) dt.setData("text/plain", "hi");
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
          }),
        );
        await settle();
        return state();
      },
      async dropAt(x: number, y: number) {
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: fileDT(),
          }),
        );
        await settle();
        return state();
      },
      async dragAssetAt(x: number, y: number, json: string) {
        const dt = new DataTransfer();
        dt.setData("application/x-openlen-image", json);
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
          }),
        );
        await settle();
        return state();
      },
      async dropAssetAt(x: number, y: number, json: string) {
        const dt = new DataTransfer();
        dt.setData("application/x-openlen-image", json);
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
          }),
        );
        await settle();
        return state();
      },
      async swapDrag(fromSel: string, toSel: string) {
        // Real DnD carries ONE DataTransfer from dragstart through drop.
        const dt = new DataTransfer();
        const from = document.querySelector(fromSel)!;
        from.dispatchEvent(
          new DragEvent("dragstart", {
            bubbles: true,
            cancelable: true,
            dataTransfer: dt,
          }),
        );
        const to = document.querySelector(toSel)!;
        to.scrollIntoView({ block: "center" });
        const r = to.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new DragEvent("dragover", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
          }),
        );
        await settle();
        const s = state();
        const t2 = document.elementFromPoint(x, y) || document.body;
        t2.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
          }),
        );
        await settle();
        return s;
      },
      async moveAt(x: number, y: number) {
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: x,
            clientY: y,
          }),
        );
        await settle();
        return state();
      },
      clickAt(x: number, y: number) {
        const t = document.elementFromPoint(x, y) || document.body;
        t.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
          }),
        );
      },
      escape() {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      },
      center(sel: string) {
        const r = document.querySelector(sel)!.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      state,
    };
  });
  return frame;
}

const msgs = (page: Page) => page.evaluate(() => (window as Win).__msgs || []);
const postToFrame = (page: Page, msg: Record<string, unknown>) =>
  page.evaluate((m) => {
    (
      document.getElementById("f") as HTMLIFrameElement
    ).contentWindow!.postMessage(m, "*");
  }, msg);

test.describe("Drop engine", () => {
  test("drag affordances cycle: image → edge line → section bg; text drags ignored", async ({
    page,
  }) => {
    const frame = await setup(page);

    // Over the image → replace target + chip.
    let s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#pic");
      return d.dragAt(c.x, c.y);
    });
    expect(s.active).toBe("drag");
    expect(s.target).toBe("pic");
    expect(s.chip).toBe("Replace image");
    expect(s.line).toBe(false);

    // Near s2's top edge → insertion line.
    s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const r = document.querySelector("#s2")!.getBoundingClientRect();
      return d.dragAt(r.left + 200, r.top + 8);
    });
    expect(s.line).toBe(true);
    expect(s.chip).toBe("New section");
    expect(s.target).toBeNull();

    // s2 body, away from edges and not over an image → background tint.
    s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#s2");
      return d.dragAt(c.x, c.y);
    });
    expect(s.tint).toBe(true);
    expect(s.chip).toBe("Section background");

    // A text-only drag must produce no affordances — fresh harness, still idle.
    const frame2 = await setup(page);
    const s2 = await frame2.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#pic");
      return d.dragAt(c.x, c.y, true);
    });
    expect(s2.active).toBeNull();
    expect(s2.chip).toBeNull();
  });

  test("drop on an image posts a replace-image intent with the File, then cleans up", async ({
    page,
  }) => {
    const frame = await setup(page);
    await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#pic");
      await d.dragAt(c.x, c.y);
      await d.dropAt(c.x, c.y);
    });
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:drop-intent"),
      )
      .toBe(true);
    const intent = (await msgs(page)).find(
      (m) => m.type === "openlen:drop-intent",
    ) as unknown as {
      intent: { action: string; path: string };
    };
    expect(intent.intent.action).toBe("replace-image");
    expect(intent.intent.path).toContain("img:nth-of-type(1)");
    // The File doesn't survive evaluate's return serialization — inspect it
    // in the parent page context instead.
    const file = await page.evaluate(() => {
      const m = (window as Win).__msgs!.find(
        (x) => x.type === "openlen:drop-intent",
      ) as { file?: File } | undefined;
      return m?.file instanceof File
        ? { name: m.file.name, type: m.file.type }
        : null;
    });
    expect(file).toEqual({ name: "team-photo_v2.png", type: "image/png" });
    // State cleared synchronously on drop — no markers left for a sibling
    // serialize to leak.
    const s = await frame.evaluate(() =>
      (window as unknown as DriverWin).__drop.state(),
    );
    expect(s.active).toBeNull();
    expect(s.target).toBeNull();
  });

  test("place mode: click commits with the token, Esc cancels, disable clears", async ({
    page,
  }) => {
    const frame = await setup(page);

    // Commit path.
    await postToFrame(page, { type: "openlen:place-start", token: 7 });
    const s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#s2");
      const st = await d.moveAt(c.x, c.y);
      d.clickAt(c.x, c.y);
      return st;
    });
    expect(s.active).toBe("place");
    expect(s.chip).toBe("Section background");
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:place-commit"),
      )
      .toBe(true);
    const commit = (await msgs(page)).find(
      (m) => m.type === "openlen:place-commit",
    ) as unknown as {
      token: number;
      intent: { action: string; path: string };
    };
    expect(commit.token).toBe(7);
    expect(commit.intent.action).toBe("section-bg");
    expect(commit.intent.path).toBe("section:nth-of-type(2)");

    // Esc path.
    await postToFrame(page, { type: "openlen:place-start", token: 8 });
    await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#s1");
      await d.moveAt(c.x, c.y);
      d.escape();
    });
    await expect
      .poll(async () =>
        (await msgs(page)).some(
          (m) => m.type === "openlen:place-cancelled" && m.token === 8,
        ),
      )
      .toBe(true);

    // dropEnabled:false mid-place clears affordances + posts the cancel.
    await postToFrame(page, { type: "openlen:place-start", token: 9 });
    await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#s1");
      await d.moveAt(c.x, c.y);
    });
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: false,
      selectMode: false,
      dropEnabled: false,
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () => (window as unknown as DriverWin).__drop.state().active,
        ),
      )
      .toBeNull();
    expect(
      (await msgs(page)).some(
        (m) => m.type === "openlen:place-cancelled" && m.token === 9,
      ),
    ).toBe(true);
  });

  test("section-insert honors anchorPath (and keeps the no-anchor default)", async ({
    page,
  }) => {
    const frame = await setup(page);

    // With anchorPath → lands immediately before section 2.
    await postToFrame(page, {
      type: "openlen:section-insert",
      html: '<section id="dropped" style="height:80px"><img src="/x.webp" alt=""></section>',
      sectionType: "image",
      anchorPath: "section:nth-of-type(2)",
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            document.getElementById("dropped")?.nextElementSibling?.id ?? null,
        ),
      )
      .toBe("s2");
    await expect
      .poll(async () =>
        (await msgs(page)).some(
          (m) =>
            m.type === "openlen:edit" && m.source === "section-insert",
        ),
      )
      .toBe(true);

    // Without anchorPath → default placement (above the trailing footer).
    await postToFrame(page, {
      type: "openlen:section-insert",
      html: '<section id="dropped2" style="height:80px"><img src="/y.webp" alt=""></section>',
      sectionType: "image",
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            document.getElementById("dropped2")?.nextElementSibling?.id ?? null,
        ),
      )
      .toBe("foot");
  });

  test("media-split: side thirds offer the split, apply transforms the section", async ({
    page,
  }) => {
    const frame = await setup(page);

    // Left / right thirds of the splittable text section vs its center.
    let s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const r = document.querySelector("#s2")!.getBoundingClientRect();
      return d.dragAt(r.left + r.width * 0.15, r.top + r.height / 2);
    });
    expect(s.chip).toBe("Image on the left");
    s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const r = document.querySelector("#s2")!.getBoundingClientRect();
      return d.dragAt(r.left + r.width * 0.85, r.top + r.height / 2);
    });
    expect(s.chip).toBe("Image on the right");
    s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#s2");
      return d.dragAt(c.x, c.y);
    });
    expect(s.chip).toBe("Section background");

    // Drop on the left third → media-split intent with the side + path.
    await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const r = document.querySelector("#s2")!.getBoundingClientRect();
      const x = r.left + r.width * 0.15;
      const y = r.top + r.height / 2;
      await d.dragAt(x, y);
      await d.dropAt(x, y);
    });
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:drop-intent"),
      )
      .toBe(true);
    const im = (await msgs(page)).find(
      (m) => m.type === "openlen:drop-intent",
    ) as unknown as { intent: { action: string; side: string; path: string } };
    expect(im.intent.action).toBe("media-split");
    expect(im.intent.side).toBe("left");
    expect(im.intent.path).toBe("section:nth-of-type(2)");

    // Apply through the inspect contract (exactly what the parent posts).
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "split",
      path: "section:nth-of-type(2)",
      side: "left",
      url: "/qa-split.webp",
      alt: "qa split",
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            document.getElementById("s2")?.classList.contains("ol-split") ??
            false,
        ),
      )
      .toBe(true);
    const shape = await frame.evaluate(() => {
      const s2 = document.getElementById("s2")!;
      const kids = Array.from(s2.children) as HTMLElement[];
      return {
        kidCount: kids.length,
        mediaFirst: kids[0]?.className === "ol-split-media",
        img: kids[0]?.querySelector("img")?.getAttribute("src") ?? null,
        copyHasHeading: !!kids[1]?.querySelector("#s2-light"),
        copyHasPara: !!kids[1]?.querySelector("#s2-dark"),
        styleTag: !!document.querySelector("style[data-ol-split-style]"),
        cols: getComputedStyle(s2).gridTemplateColumns.split(" ").length,
      };
    });
    expect(shape).toEqual({
      kidCount: 2,
      mediaFirst: true,
      img: "/qa-split.webp",
      copyHasHeading: true,
      copyHasPara: true,
      styleTag: true,
      cols: 2, // 1000px-wide harness viewport ≥768 → two columns
    });
    await expect
      .poll(async () =>
        (await msgs(page)).some(
          (m) => m.type === "openlen:edit" && m.source === "props",
        ),
      )
      .toBe(true);

    // The section is split now. Over the media cell the dropped image is a
    // replace target (you can swap it); over the copy cell there's no
    // re-split — the body falls back to background.
    const overImage = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const r = document.querySelector("#s2")!.getBoundingClientRect();
      return d.dragAt(r.left + r.width * 0.15, r.top + r.height / 2);
    });
    expect(overImage.chip).toBe("Replace image");
    const overCopy = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const r = document.querySelector("#s2")!.getBoundingClientRect();
      return d.dragAt(r.left + r.width * 0.85, r.top + r.height / 2);
    });
    expect(overCopy.chip).toBe("Section background");
  });

  test("URL drags (panel assets): affordances + asset intent; malformed JSON inert", async ({
    page,
  }) => {
    const frame = await setup(page);
    const json = JSON.stringify({
      url: "https://images.openlen.com/x-1920.webp",
      alt: "studio shot",
      credit: { author: "A", authorUrl: "https://a", photoUrl: "https://p" },
    });

    const s = await frame.evaluate(async (j) => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#pic");
      return d.dragAssetAt(c.x, c.y, j);
    }, json);
    expect(s.active).toBe("drag");
    expect(s.target).toBe("pic");
    expect(s.chip).toBe("Replace image");

    await frame.evaluate(async (j) => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#pic");
      await d.dropAssetAt(c.x, c.y, j);
    }, json);
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:drop-intent"),
      )
      .toBe(true);
    const intent = (await msgs(page)).find(
      (m) => m.type === "openlen:drop-intent",
    ) as unknown as {
      intent: { action: string };
      asset?: { url: string; alt?: string; credit?: { author: string } };
      file?: unknown;
    };
    expect(intent.intent.action).toBe("replace-image");
    expect(intent.asset?.url).toBe("https://images.openlen.com/x-1920.webp");
    expect(intent.asset?.alt).toBe("studio shot");
    expect(intent.asset?.credit?.author).toBe("A");
    expect(intent.file).toBeUndefined();

    // Malformed payload → no second intent, state cleared.
    await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      const c = d.center("#pic");
      await d.dragAssetAt(c.x, c.y, "{not json");
      await d.dropAssetAt(c.x, c.y, "{not json");
    });
    await frame.waitForTimeout(200);
    expect(
      (await msgs(page)).filter((m) => m.type === "openlen:drop-intent").length,
    ).toBe(1);
    const st = await frame.evaluate(() =>
      (window as unknown as DriverWin).__drop.state(),
    );
    expect(st.active).toBeNull();
  });

  test("swap gesture: dragging a page image onto another exchanges src+alt", async ({
    page,
  }) => {
    const frame = await setup(page);
    const before = await frame.evaluate(() => ({
      a: document.getElementById("pic")!.getAttribute("src"),
      b: document.getElementById("pic2")!.getAttribute("src"),
      altA: document.getElementById("pic")!.getAttribute("alt"),
      altB: document.getElementById("pic2")!.getAttribute("alt"),
    }));
    const s = await frame.evaluate(async () => {
      const d = (window as unknown as DriverWin).__drop;
      return d.swapDrag("#pic", "#pic2");
    });
    expect(s.chip).toBe("Swap images");
    expect(s.target).toBe("pic2");
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:drop-intent"),
      )
      .toBe(true);
    const im = (await msgs(page)).find(
      (m) => m.type === "openlen:drop-intent",
    ) as unknown as {
      intent: { action: string; fromPath: string; toPath: string };
    };
    expect(im.intent.action).toBe("swap-images");
    expect(im.intent.fromPath).not.toBe(im.intent.toPath);

    // Route it exactly as the parent does.
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "swap-images",
      fromPath: im.intent.fromPath,
      toPath: im.intent.toPath,
    });
    await expect
      .poll(() =>
        frame.evaluate(() => document.getElementById("pic")!.getAttribute("src")),
      )
      .toBe(before.b);
    const after = await frame.evaluate(() => ({
      b: document.getElementById("pic2")!.getAttribute("src"),
      altA: document.getElementById("pic")!.getAttribute("alt"),
      altB: document.getElementById("pic2")!.getAttribute("alt"),
    }));
    expect(after.b).toBe(before.a);
    expect(after.altA).toBe(before.altB);
    expect(after.altB).toBe(before.altA);
  });

  test("remove: un-splits a split, removes empty drop sections, clear restores re-ink", async ({
    page,
  }) => {
    const frame = await setup(page);
    // The trash affordance is edit-gated — turn edit mode on for the real
    // pill-button path.
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: true,
      selectMode: false,
      dropEnabled: true,
    });

    // (a) split s2, then remove its media image via the REAL trash button.
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "split",
      path: "section:nth-of-type(2)",
      side: "left",
      url: "/qa-split.webp",
      alt: "qa",
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            document.getElementById("s2")?.classList.contains("ol-split") ??
            false,
        ),
      )
      .toBe(true);
    await frame.evaluate(() => {
      const img = document.querySelector(
        "#s2 .ol-split-media img",
      ) as HTMLElement;
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: r.left + 12,
          clientY: r.top + 12,
        }),
      );
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.querySelector(".openlen-replace-remove") as HTMLElement | null)
              ?.style.display ?? "none",
        ),
      )
      .toBe("inline-flex");
    await frame.evaluate(() =>
      (document.querySelector(".openlen-replace-remove") as HTMLElement).click(),
    );
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:asset-remove"),
      )
      .toBe(true);
    const rm = (await msgs(page)).find(
      (m) => m.type === "openlen:asset-remove",
    ) as unknown as { path: string };
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "remove-image",
      path: rm.path,
    });
    await expect
      .poll(() =>
        frame.evaluate(() => {
          const s2 = document.getElementById("s2")!;
          return (
            !s2.classList.contains("ol-split") &&
            !s2.querySelector(".ol-split-media") &&
            s2.firstElementChild?.id === "s2-light"
          );
        }),
      )
      .toBe(true);

    // (b) a drop-created image section is removed whole with its image.
    await postToFrame(page, {
      type: "openlen:section-insert",
      html: '<section id="solo" style="height:80px"><img src="/x.webp" alt=""></section>',
      sectionType: "image",
      anchorPath: "section:nth-of-type(2)",
    });
    await expect
      .poll(() => frame.evaluate(() => !!document.getElementById("solo")))
      .toBe(true);
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "remove-image",
      path: "section:nth-of-type(2) > img:nth-of-type(1)",
    });
    await expect
      .poll(() => frame.evaluate(() => document.getElementById("solo") === null))
      .toBe(true);

    // (c) clearing a bg fill restores the re-inked text to its original color.
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "style-bg",
      path: "section:nth-of-type(2)",
      kind: "image",
      value: "/photo.webp",
      legibility: { ink: "#ffffff", scrimColor: "", groundLum: 0.05 },
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () => getComputedStyle(document.getElementById("s2-dark")!).color,
        ),
      )
      .toBe("rgb(255, 255, 255)");
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "style-bg",
      path: "section:nth-of-type(2)",
      kind: "clear",
      value: "",
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () => getComputedStyle(document.getElementById("s2-dark")!).color,
        ),
      )
      .toBe("rgb(17, 17, 17)");
    expect(
      await frame.evaluate(() =>
        document.getElementById("s2-dark")!.getAttribute("data-ol-reink"),
      ),
    ).toBeNull();

    // (d) the main Replace pill (was silently DEAD in edit mode — the inspect
    // script stopped its clicks) now posts asset-clicked via the doc-capture fix.
    await frame.evaluate(() => {
      const img = document.getElementById("pic2") as HTMLElement;
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: r.left + 8,
          clientY: r.top + 8,
        }),
      );
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.querySelector(".openlen-replace-button") as HTMLElement | null)
              ?.style.display ?? "none",
        ),
      )
      .toBe("inline-flex");
    await frame.evaluate(() =>
      (document.querySelector(".openlen-replace-button") as HTMLElement).click(),
    );
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:asset-clicked"),
      )
      .toBe(true);
  });

  test("remove: a dropped video shows the trash and removes the video + its empty section", async ({
    page,
  }) => {
    const frame = await setup(page);
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: true,
      selectMode: false,
      dropEnabled: true,
    });

    // A solo <video> section — mirrors how a Motion/video hero lands on a page.
    await postToFrame(page, {
      type: "openlen:section-insert",
      html:
        '<section id="vid-solo" style="height:200px">' +
        '<video id="thevid" src="/hero.mp4" style="width:100%;height:200px;display:block"></video>' +
        "</section>",
      sectionType: "image",
      anchorPath: "section:nth-of-type(2)",
    });
    await expect
      .poll(() => frame.evaluate(() => !!document.getElementById("vid-solo")))
      .toBe(true);

    // Hover the video → the trash affordance must appear for kind:video (it was
    // image-only before; this is the behavior the fix adds).
    await frame.evaluate(() => {
      const v = document.getElementById("thevid") as HTMLElement;
      v.scrollIntoView({ block: "center" });
      const r = v.getBoundingClientRect();
      v.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: r.left + 20,
          clientY: r.top + 20,
        }),
      );
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.querySelector(".openlen-replace-remove") as HTMLElement | null)
              ?.style.display ?? "none",
        ),
      )
      .toBe("inline-flex");

    // Click the trash → posts asset-remove with kind:video.
    await frame.evaluate(() =>
      (document.querySelector(".openlen-replace-remove") as HTMLElement).click(),
    );
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:asset-remove"),
      )
      .toBe(true);
    const removeMsg = (await msgs(page)).find(
      (m) => m.type === "openlen:asset-remove",
    ) as unknown as { path: string; kind: string };
    expect(removeMsg.kind).toBe("video");

    // Forward the parent's kind-agnostic remove-image → the video AND its now
    // empty host section are gone.
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "remove-image",
      path: removeMsg.path,
    });
    await expect
      .poll(() =>
        frame.evaluate(() => document.getElementById("vid-solo") === null),
      )
      .toBe(true);
  });

  test("hover chrome stays put when the pointer moves onto the trash/Replace (no vanish-before-click)", async ({
    page,
  }) => {
    const frame = await setup(page);
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: true,
      selectMode: false,
      dropEnabled: true,
    });

    // Hover the image → Replace pill + trash appear.
    await frame.evaluate(() => {
      const img = document.getElementById("pic") as HTMLElement;
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }),
      );
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.querySelector(".openlen-replace-remove") as HTMLElement | null)
              ?.style.display ?? "none",
        ),
      )
      .toBe("inline-flex");

    // Move the pointer ONTO the trash (what a user does to click it). The
    // document-level mousemove must NOT hide our own chrome.
    await frame.evaluate(() => {
      const rm = document.querySelector(".openlen-replace-remove") as HTMLElement;
      const r = rm.getBoundingClientRect();
      rm.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }),
      );
    });
    // Past the 120ms hide delay — the buttons must still be there to click.
    await page.waitForTimeout(240);
    const state = await frame.evaluate(() => ({
      trash: (document.querySelector(".openlen-replace-remove") as HTMLElement | null)?.style.display ?? "none",
      pill: (document.querySelector(".openlen-replace-button") as HTMLElement | null)?.style.display ?? "none",
    }));
    expect(state.trash).toBe("inline-flex");
    expect(state.pill).toBe("inline-flex");
  });

  test("section toolbar: duplicate / move / delete post source + action", async ({
    page,
  }) => {
    const frame = await setup(page);
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: true,
      selectMode: false,
      dropEnabled: true,
    });

    const hoverEl = (getEl: string) =>
      frame.evaluate((code) => {
        const el = new Function(`return (${code});`)() as HTMLElement;
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        const t =
          document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) ||
          el;
        t.dispatchEvent(
          new MouseEvent("mousemove", {
            bubbles: true,
            clientX: r.left + r.width / 2,
            clientY: r.top + r.height / 2,
          }),
        );
      }, getEl);
    const clickAct = (act: string) =>
      frame.evaluate(
        (a) =>
          (
            document.querySelector(
              `.openlen-section-toolbar button[data-act="${a}"]`,
            ) as HTMLElement
          ).click(),
        act,
      );
    const toolbarVisible = () =>
      frame.evaluate(
        () => !!document.querySelector(".openlen-section-toolbar.visible"),
      );
    const actionMsg = async (action: string) =>
      (await msgs(page)).some(
        (m) =>
          m.type === "openlen:edit" &&
          m.source === "section-toolbar" &&
          (m as { action?: string }).action === action,
      );

    // Duplicate s2 → a clone right after it, ids stripped.
    await hoverEl('document.getElementById("s2")');
    await expect.poll(toolbarVisible).toBe(true);
    await clickAct("duplicate");
    await expect.poll(() => actionMsg("duplicate")).toBe(true);
    const dup = await frame.evaluate(() => {
      const clone = document.getElementById("s2")!
        .nextElementSibling as HTMLElement;
      return {
        count: document.querySelectorAll("section").length,
        cloneIsSection: clone?.tagName === "SECTION",
        cloneClean:
          !!clone && !clone.id && clone.querySelectorAll("[id]").length === 0,
      };
    });
    expect(dup).toEqual({ count: 3, cloneIsSection: true, cloneClean: true });

    // Move s2 down — it lands below its clone.
    await hoverEl('document.getElementById("s2")');
    await expect.poll(toolbarVisible).toBe(true);
    await clickAct("down");
    await expect.poll(() => actionMsg("down")).toBe(true);
    expect(
      await frame.evaluate(
        () => document.getElementById("s2")!.previousElementSibling!.tagName,
      ),
    ).toBe("SECTION");
    expect(
      await frame.evaluate(
        () => document.getElementById("s2")!.previousElementSibling!.id,
      ),
    ).toBe("");

    // Delete the clone (now between s1 and s2).
    await hoverEl('document.getElementById("s2").previousElementSibling');
    await expect.poll(toolbarVisible).toBe(true);
    await clickAct("delete");
    await expect.poll(() => actionMsg("delete")).toBe(true);
    expect(
      await frame.evaluate(() => document.querySelectorAll("section").length),
    ).toBe(2);
    expect(
      await frame.evaluate(() => !!document.getElementById("s2")),
    ).toBe(true);
  });

  test("resize grip: drag sets a responsive width % and posts source resize", async ({
    page,
  }) => {
    const frame = await setup(page);
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: true,
      selectMode: false,
      dropEnabled: true,
    });
    await frame.evaluate(() => {
      const img = document.getElementById("pic") as HTMLElement;
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      img.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: r.left + 10,
          clientY: r.top + 10,
        }),
      );
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.querySelector(".openlen-resize-grip") as HTMLElement | null)
              ?.style.display ?? "none",
        ),
      )
      .toBe("block");
    await frame.evaluate(() => {
      const grip = document.querySelector(".openlen-resize-grip") as HTMLElement;
      const r = grip.getBoundingClientRect();
      const x = r.left + 7;
      const y = r.top + 7;
      grip.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          clientX: x,
          clientY: y,
        }),
      );
      grip.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          clientX: x - 60,
          clientY: y,
        }),
      );
      grip.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          clientX: x - 60,
          clientY: y,
        }),
      );
    });
    const w = await frame.evaluate(
      () => (document.getElementById("pic") as HTMLElement).style.width,
    );
    expect(w).toMatch(/^\d+(\.\d+)?%$/);
    expect(parseFloat(w)).toBeLessThan(100);
    expect(
      await frame.evaluate(
        () => (document.getElementById("pic") as HTMLElement).style.height,
      ),
    ).toBe("auto");
    await expect
      .poll(async () =>
        (await msgs(page)).some(
          (m) => m.type === "openlen:edit" && m.source === "resize",
        ),
      )
      .toBe(true);
  });

  test("block chip: ↑ swaps sibling blocks inside the section", async ({
    page,
  }) => {
    const frame = await setup(page);
    await postToFrame(page, {
      type: "openlen:set-mode",
      editMode: true,
      selectMode: false,
      dropEnabled: true,
    });
    await frame.evaluate(() => {
      const p = document.getElementById("s2-dark") as HTMLElement;
      p.scrollIntoView({ block: "center" });
      const r = p.getBoundingClientRect();
      p.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + 5,
        }),
      );
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () => !!document.querySelector(".openlen-block-chip.visible"),
        ),
      )
      .toBe(true);
    await frame.evaluate(() =>
      (
        document.querySelector(
          '.openlen-block-chip button[data-block-act="up"]',
        ) as HTMLElement
      ).click(),
    );
    await expect
      .poll(() =>
        frame.evaluate(
          () => document.getElementById("s2")!.firstElementChild!.id,
        ),
      )
      .toBe("s2-dark");
    await expect
      .poll(async () =>
        (await msgs(page)).some(
          (m) =>
            m.type === "openlen:edit" &&
            m.source === "block-move" &&
            (m as { action?: string }).action === "up",
        ),
      )
      .toBe(true);
  });

  test("Ctrl+Z in the canvas forwards an undo request to the parent", async ({
    page,
  }) => {
    const frame = await setup(page);
    await frame.evaluate(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "z",
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await expect
      .poll(async () =>
        (await msgs(page)).some((m) => m.type === "openlen:undo-request"),
      )
      .toBe(true);
  });

  test("gradient apply-prop: sets the gradient + re-inks failing text", async ({
    page,
  }) => {
    const frame = await setup(page);
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "style-bg",
      path: "section:nth-of-type(2)",
      kind: "gradient",
      value: "linear-gradient(135deg, #0a0f1e, #1e293b)",
      legibility: { ink: "#ffffff", scrimColor: "", groundLum: 0.05 },
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.getElementById("s2") as HTMLElement).style
              .backgroundImage,
        ),
      )
      .toContain("linear-gradient");
    const r = await frame.evaluate(() => {
      const s2 = document.getElementById("s2") as HTMLElement;
      const dark = document.getElementById("s2-dark") as HTMLElement;
      return {
        bg: s2.style.backgroundImage,
        darkColor: getComputedStyle(dark).color,
        stash: dark.getAttribute("data-ol-reink"),
      };
    });
    expect(r.bg).not.toContain("url(");
    expect(r.darkColor).toBe("rgb(255, 255, 255)");
    expect(r.stash).not.toBeNull();
    await expect
      .poll(async () =>
        (await msgs(page)).some(
          (m) => m.type === "openlen:edit" && m.source === "props",
        ),
      )
      .toBe(true);
  });

  test("style-bg with legibility: scrim layers in, failing text re-inks, re-apply re-measures", async ({
    page,
  }) => {
    const frame = await setup(page);

    // Dark ground (photo lum 0.1): the dark paragraph fails contrast → white;
    // the white heading already passes → untouched.
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "style-bg",
      path: "section:nth-of-type(2)",
      kind: "image",
      value: "/photo.webp",
      legibility: {
        ink: "#ffffff",
        scrimColor: "rgba(0,0,0,0.45)",
        groundLum: 0.1,
      },
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.getElementById("s2") as HTMLElement).style
              .backgroundImage,
        ),
      )
      .toContain("linear-gradient");
    const first = await frame.evaluate(() => {
      const s2 = document.getElementById("s2") as HTMLElement;
      const dark = document.getElementById("s2-dark") as HTMLElement;
      const light = document.getElementById("s2-light") as HTMLElement;
      return {
        bg: s2.style.backgroundImage,
        darkColor: getComputedStyle(dark).color,
        darkStash: dark.getAttribute("data-ol-reink"),
        lightStash: light.getAttribute("data-ol-reink"),
      };
    });
    expect(first.bg).toContain('url("/photo.webp")');
    expect(first.darkColor).toBe("rgb(255, 255, 255)");
    expect(first.darkStash).not.toBeNull();
    expect(first.lightStash).toBeNull();

    // Light ground (lum 0.9, no scrim): prior re-ink restores first, then the
    // white heading fails → dark ink; the paragraph passes on its ORIGINAL color.
    await postToFrame(page, {
      type: "openlen:apply-prop",
      scope: "style-bg",
      path: "section:nth-of-type(2)",
      kind: "image",
      value: "/photo2.webp",
      legibility: { ink: "#111827", scrimColor: "", groundLum: 0.9 },
    });
    await expect
      .poll(() =>
        frame.evaluate(
          () =>
            (document.getElementById("s2") as HTMLElement).style
              .backgroundImage,
        ),
      )
      .toContain("photo2");
    const second = await frame.evaluate(() => {
      const s2 = document.getElementById("s2") as HTMLElement;
      const dark = document.getElementById("s2-dark") as HTMLElement;
      const light = document.getElementById("s2-light") as HTMLElement;
      return {
        bg: s2.style.backgroundImage,
        darkColor: getComputedStyle(dark).color,
        darkStash: dark.getAttribute("data-ol-reink"),
        lightColor: getComputedStyle(light).color,
        lightStash: light.getAttribute("data-ol-reink"),
      };
    });
    expect(second.bg).not.toContain("linear-gradient");
    expect(second.darkColor).toBe("rgb(17, 17, 17)"); // restored original
    expect(second.darkStash).toBeNull();
    expect(second.lightColor).toBe("rgb(17, 24, 39)"); // #111827
    expect(second.lightStash).not.toBeNull();
  });
});
