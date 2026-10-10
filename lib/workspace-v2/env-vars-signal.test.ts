// La señal de «cambiaron las variables» (env-vars-signal.ts): sube la versión
// de ESE proyecto y avisa a quien escucha, como abrir-fichero.ts.
import { describe, expect, it, vi } from "vitest";
import { envVarsVersion, notifyEnvVarsChanged, subscribeEnvVars } from "./env-vars-signal";

describe("la señal de las variables de entorno", () => {
  it("sube la versión de ESE proyecto y avisa; desuscrito, ya no", () => {
    const fn = vi.fn();
    const off = subscribeEnvVars(fn);
    const antes = envVarsVersion("p1");
    notifyEnvVarsChanged("p1");
    expect(envVarsVersion("p1")).toBe(antes + 1);
    expect(envVarsVersion("p2")).toBe(0);
    expect(envVarsVersion(null)).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    notifyEnvVarsChanged("p1");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
