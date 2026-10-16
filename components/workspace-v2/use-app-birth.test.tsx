// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { LatestTurn } from "@/lib/workspace-v2/app-birth";
import { READY_MS, LEAVE_MS, useAppBirth } from "./use-app-birth";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let seen: ReturnType<typeof useAppBirth>;

function Probe({ turn, bornAsApp }: { turn: LatestTurn | null; bornAsApp: boolean }) {
  seen = useAppBirth(turn, bornAsApp);
  return null;
}

const turn = (over: Partial<LatestTurn> = {}): LatestTurn => ({ id: "t1", status: "streaming", cut: false, isFirst: true, actions: [], ...over });
const show = (t: LatestTurn | null, bornAsApp = true) => act(() => root.render(<Probe turn={t} bornAsApp={bornAsApp} />));

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useAppBirth", () => {
  it("is there while the app's first turn runs", () => {
    show(turn());
    expect(seen?.finished).toBe(false);
    expect(seen?.leaving).toBe(false);
  });

  it("says ready when the turn ends well, fades, and then goes", () => {
    show(turn());
    show(turn({ status: "applied", actions: [{ tool: "Write", status: "done", summary: "src/App.tsx" }] }));
    expect(seen?.finished).toBe(true);
    act(() => vi.advanceTimersByTime(READY_MS - LEAVE_MS));
    expect(seen?.leaving).toBe(true);
    act(() => vi.advanceTimersByTime(LEAVE_MS));
    expect(seen).toBeNull();
  });

  it("goes at once when the turn fails", () => {
    show(turn());
    show(turn({ status: "error" }));
    expect(seen).toBeNull();
  });

  it("is never there for a page", () => {
    show(turn(), false);
    expect(seen).toBeNull();
  });
});
