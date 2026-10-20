// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chromiumEnv } from "./chromium-env";

const SERVER_ENV: Record<string, string> = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/openlen-deploy",
  TZ: "UTC",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  LC_CTYPE: "C.UTF-8",
  TMPDIR: "/tmp",
  FONTCONFIG_PATH: "/etc/fonts",
  DATABASE_URL: "postgres://openlen:pw@127.0.0.1/openlen",
  AUTH_SECRET: "s",
  NEXTAUTH_SECRET: "s",
  FIREWORKS_API_KEY: "k",
  DEEPINFRA_API_KEY: "k",
  GOOGLE_API_KEY: "k",
  POLAR_ACCESS_TOKEN: "t",
  NODE_OPTIONS: "--require /opt/x.js",
  LD_PRELOAD: "/tmp/evil.so",
  HTTPS_PROXY: "http://user:pw@proxy:3128",
  PUPPETEER_EXECUTABLE_PATH: "/usr/bin/google-chrome",
};

describe("chromiumEnv", () => {
  it("keeps what Chromium needs to run and forces HOME=/tmp", () => {
    expect(chromiumEnv(SERVER_ENV, "linux")).toEqual({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp",
      TZ: "UTC",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      LC_CTYPE: "C.UTF-8",
      TMPDIR: "/tmp",
      FONTCONFIG_PATH: "/etc/fonts",
    });
  });

  it("🔴 is an allowlist: a variable it has never heard of does not pass", () => {
    const env = chromiumEnv({ ...SERVER_ENV, SOME_NEW_PROVIDER_KEY: "k", MY_SECRET: "s" }, "linux");
    expect(env).not.toHaveProperty("SOME_NEW_PROVIDER_KEY");
    expect(env).not.toHaveProperty("MY_SECRET");
  });

  it("matches names exactly on POSIX, where they are case-sensitive", () => {
    expect(chromiumEnv({ path: "/x", Tz: "UTC" }, "linux")).toEqual({ HOME: "/tmp" });
  });

  it("on Windows keeps what the process needs to start, whatever the case of its name", () => {
    const env = chromiumEnv(
      { Path: "C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\T", LOCALAPPDATA: "C:\\L", DATABASE_URL: "x" },
      "win32",
    );
    expect(env).toEqual({ Path: "C:\\Windows", SystemRoot: "C:\\Windows", TEMP: "C:\\T", LOCALAPPDATA: "C:\\L", HOME: "/tmp" });
  });

  it("leaves out variables that are set but undefined", () => {
    expect(chromiumEnv({ PATH: undefined, TZ: "UTC" }, "linux")).toEqual({ TZ: "UTC", HOME: "/tmp" });
  });
});
