import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createScanController, SWEEP_MS } from "@/lib/workspace-v2/scan-controller";
import { ScanOverlay } from "./scan-overlay";

// Tells React's act() this environment supports it (no testing-library here
// to set this up for us) — silences the "not configured to support act"
// warning without changing behavior.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom doesn't implement ResizeObserver (real browsers always do) — stub it
// so the component's --olscan-sweep measurement effect doesn't throw.
beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

// @testing-library/react isn't a repo dependency (cero deps nuevas constraint)
// — render manually via react-dom/client + act(), same assertions as the
// brief's Step-1 spec.
function renderOverlay(props: React.ComponentProps<typeof ScanOverlay>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(<ScanOverlay {...props} />);
  });
  return { container, root };
}

const roots: Root[] = [];
afterEach(() => {
  roots.splice(0).forEach((r) => act(() => r.unmount()));
});

function makeC() {
  return createScanController({ killSwitch: () => false, immediate: () => false });
}

describe("ScanOverlay", () => {
  it("idle: no renderiza capas de escaneo", () => {
    const c = makeC();
    const { container, root } = renderOverlay({ controller: c });
    roots.push(root);
    expect(container.querySelector(".olscan-root.scanning")).toBeNull();
  });

  it("scanning: clases loop + vignette + corners presentes; input-block activo", () => {
    const c = makeC();
    const { container, root } = renderOverlay({ controller: c });
    roots.push(root);
    act(() => c.start());
    expect(container.querySelector(".olscan-root.scanning.loop")).not.toBeNull();
    expect(container.querySelectorAll(".olscan-corner")).toHaveLength(4);
    const block = container.querySelector(".olscan-block") as HTMLElement;
    expect(block).not.toBeNull();
  });

  it("finalizing: clase final sustituye a loop; ring aparece en el estado ring", () => {
    vi.useFakeTimers();
    const c = makeC();
    const { container, root } = renderOverlay({ controller: c });
    roots.push(root);
    act(() => {
      c.start();
      c.finish(() => {});
      c.onIteration();
    });
    expect(container.querySelector(".olscan-root.final")).not.toBeNull();
    expect(container.querySelector(".olscan-root.loop")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SWEEP_MS + 1);
    });
    expect(container.querySelector(".olscan-ring.on")).not.toBeNull();
    vi.useRealTimers();
  });

  it("onBusyChange refleja busy del controller", () => {
    const c = makeC();
    const seen: boolean[] = [];
    const { root } = renderOverlay({ controller: c, onBusyChange: (b) => seen.push(b) });
    roots.push(root);
    act(() => c.start());
    expect(seen.at(-1)).toBe(true);
    act(() => c.cancel());
    expect(seen.at(-1)).toBe(false);
  });

  it("animationiteration sobre la ventana llama controller.onIteration", () => {
    const c = makeC();
    const spy = vi.spyOn(c, "onIteration");
    const { container, root } = renderOverlay({ controller: c });
    roots.push(root);
    act(() => c.start());
    const win = container.querySelector(".olscan-win") as HTMLElement;
    act(() => {
      win.dispatchEvent(new Event("animationiteration", { bubbles: false }));
    });
    expect(spy).toHaveBeenCalled();
  });
});
