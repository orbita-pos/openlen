// LA ACTIVACIÓN DEL ENCARGO (pieza 8): del proceso, como en DeepSeek. Al
// arrancar no hay nada armado: tras un reinicio, todo encargo espera al dueño.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetGoalActivation, armGoal, disarmGoal, goalActivation } from "./goal-activation";

beforeEach(() => _resetGoalActivation());

describe("la activación del encargo", () => {
  it("sin nada armado, desarmado", () => {
    expect(goalActivation("p1", "goal-1")).toBe("disarmed");
    expect(goalActivation("p1", undefined)).toBe("disarmed");
  });

  it("armado sólo para ESE encargo de ESE proyecto", () => {
    armGoal("p1", "goal-1");
    expect(goalActivation("p1", "goal-1")).toBe("armed");
    expect(goalActivation("p1", "goal-2")).toBe("disarmed");
    expect(goalActivation("p2", "goal-1")).toBe("disarmed");
  });

  it("desarmar lo quita", () => {
    armGoal("p1", "goal-1");
    disarmGoal("p1");
    expect(goalActivation("p1", "goal-1")).toBe("disarmed");
  });

  it("vive en el proceso: otra copia del módulo ve lo mismo", async () => {
    armGoal("p1", "goal-1");
    vi.resetModules();
    const otra = await import("./goal-activation");
    expect(otra.goalActivation("p1", "goal-1")).toBe("armed");
  });
});
