// The figure as markup for the published bubble (phase 2A): exactly what the workspace's AssistantFigure draws.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AssistantFigure } from "@/components/workspace-v2/assistant/figure";

import { figureSvg } from "./figure-svg";
import { ASSISTANT_SHAPES } from "./names";

describe("figureSvg", () => {
  it("draws exactly what AssistantFigure draws, for every shape", () => {
    for (const shape of ASSISTANT_SHAPES) {
      for (const [color, size] of [["#F4A48B", 32], ["#5FB8A6", 28]] as const) {
        expect(figureSvg(shape, color, size), shape).toBe(renderToStaticMarkup(createElement(AssistantFigure, { shape, color, size })));
      }
    }
  });
});
