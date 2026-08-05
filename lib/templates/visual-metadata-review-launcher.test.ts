import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { BuildOptions, BuildResult } from "esbuild";
import type { ReviewClientAssets, RunningReviewServer, VisualMetadataReviewServerOptions } from "./visual-metadata-review-server";
import type {
  LoadedReviewSource,
  ReviewWorkspaceConfig,
  VisualMetadataReviewWorkspace,
} from "./visual-metadata-review-session-store";
import {
  VisualMetadataReviewLauncherError,
  buildReviewClientAssets,
  openReviewBrowser,
  parseReviewCliArgs,
  runVisualMetadataReviewer,
  type ReviewSignal,
} from "./visual-metadata-review-launcher";

const REQUIRED_PATH_ARGS = [
  "--input", "scratch/source.json",
  "--session", "scratch/session.json",
  "--reviewed-out", "scratch/reviewed.json",
  "--audit-out", "scratch/audit.json",
] as const;

function makeLoadedSource(): LoadedReviewSource {
  return {
    sha256: "a".repeat(64),
    rows: [],
    counts: {
      rows: 20,
      unique: 20,
      suggested: 19,
      failed: 1,
      requiredApprovals: 19,
    },
  };
}

function makeWorkspace(close: () => Promise<void>): VisualMetadataReviewWorkspace {
  return {
    snapshot: vi.fn(() => {
      throw new Error("unused snapshot");
    }),
    getSafeReviewDto: vi.fn(() => {
      throw new Error("unused safe DTO");
    }),
    getScreenshotSourceUrl: vi.fn(() => null),
    dispatch: vi.fn(async () => {
      throw new Error("unused dispatch");
    }),
    setCurrentTemplate: vi.fn(async () => {
      throw new Error("unused navigation");
    }),
    exportFinal: vi.fn(async () => {
      throw new Error("unused export");
    }),
    exportAuditBackup: vi.fn(async () => {
      throw new Error("unused audit export");
    }),
    close,
  };
}

function fakeBuildResult(): BuildResult {
  return {
    errors: [],
    warnings: [],
    outputFiles: [
      {
        path: "C:\\virtual\\app.js",
        contents: new TextEncoder().encode("javascript"),
        hash: "js",
        text: "javascript",
      },
      {
        path: "C:\\virtual\\app.css",
        contents: new TextEncoder().encode("css"),
        hash: "css",
        text: "css",
      },
    ],
    metafile: undefined,
    mangleCache: undefined,
  };
}

describe("parseReviewCliArgs", () => {
  it.each([
    ["--input"],
    ["--session"],
    ["--reviewed-out"],
    ["--audit-out"],
  ])("requires the normal review path %s", (requiredFlag) => {
    const argv = REQUIRED_PATH_ARGS.filter((value, index, all) => {
      const flagIndex = (all as readonly string[]).indexOf(requiredFlag);
      return index !== flagIndex && index !== flagIndex + 1;
    });

    expect(() => parseReviewCliArgs(argv, {})).toThrowError(
      expect.objectContaining<Partial<VisualMetadataReviewLauncherError>>({
        code: "REVIEW_LAUNCH_ARGUMENTS_INVALID",
      }),
    );
  });

  it("resolves a complete reviewer identity flag pair before environment values", () => {
    const parsed = parseReviewCliArgs([
      ...REQUIRED_PATH_ARGS,
      "--reviewer-name", "Flag Reviewer",
      "--reviewer-email", "flag@example.test",
    ], {
      OPENLEN_REVIEWER_NAME: "Environment Reviewer",
      OPENLEN_REVIEWER_EMAIL: "environment@example.test",
    });

    expect(parsed.reviewer).toEqual({
      name: "Flag Reviewer",
      email: "flag@example.test",
    });
  });

  it("uses the identity form fallback only when neither identity source is configured", () => {
    const parsed = parseReviewCliArgs(REQUIRED_PATH_ARGS, {});

    expect(parsed.reviewer).toBeUndefined();
  });

  it("requires only input in validate-only mode", () => {
    expect(parseReviewCliArgs([
      "--input", "scratch/source.json",
      "--validate-only",
    ], {
      OPENLEN_REVIEWER_NAME: "Incomplete environment identity must be irrelevant",
    })).toEqual({
      inputPath: "scratch/source.json",
      validateOnly: true,
      noOpen: false,
      reviewer: undefined,
    });
  });
});

describe("buildReviewClientAssets", () => {
  it("builds exactly one JavaScript and one CSS asset entirely in memory", async () => {
    let received: BuildOptions | undefined;
    const build = vi.fn(async (options: BuildOptions) => {
      received = options;
      return fakeBuildResult();
    });

    const assets = await buildReviewClientAssets({
      build,
      cwd: "C:\\repo",
    });

    expect(assets).toEqual({ javascript: "javascript", css: "css" });
    expect(received).toMatchObject({
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: {
        "process.env.NODE_ENV": "\"production\"",
      },
    });
    expect(received?.entryPoints).toEqual([
      "C:\\repo\\tools\\template-visual-metadata-reviewer\\app.tsx",
    ]);
    expect(received?.outdir).toBe("C:\\repo\\.openlen-review-client");
  });

  it.each([
    [["app.js", "one.js"], ["app.css", "one.css"]],
    [["app.js", "one.js"], []],
    [[], [["app.css", "one.css"]]],
  ] as const)("rejects missing or duplicate emitted client assets", async (javascriptFiles, cssFiles) => {
    const outputFiles = [
      ...javascriptFiles.map(([path, text]) => ({
        path,
        text,
        contents: new TextEncoder().encode(text),
        hash: path,
      })),
      ...cssFiles.map(([path, text]) => ({
        path,
        text,
        contents: new TextEncoder().encode(text),
        hash: path,
      })),
    ];

    await expect(buildReviewClientAssets({
      cwd: "C:\\repo",
      build: async () => ({
        errors: [],
        warnings: [],
        outputFiles,
        metafile: undefined,
        mangleCache: undefined,
      }),
    })).rejects.toMatchObject({
      code: "REVIEW_CLIENT_BUILD_FAILED",
    });
  });
});

describe("openReviewBrowser", () => {
  const bootstrapUrl = `http://127.0.0.1:43123/?bootstrap=${"a".repeat(64)}`;

  it.each([
    ["win32", "rundll32.exe", ["url.dll,FileProtocolHandler", bootstrapUrl]],
    ["darwin", "open", [bootstrapUrl]],
    ["linux", "xdg-open", [bootstrapUrl]],
  ] as const)("opens a validated server bootstrap URL on %s using a fixed command", async (
    platform,
    executable,
    args,
  ) => {
    const unref = vi.fn();
    const child = Object.assign(new EventEmitter(), { unref });
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    await openReviewBrowser(bootstrapUrl, {
      platform,
      spawn,
    });

    expect(spawn).toHaveBeenCalledWith(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    expect(unref).toHaveBeenCalledOnce();
  });

  it("maps an asynchronous browser process error to a safe category", async () => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit("error", new Error("private executable detail")));
      return child;
    });

    await expect(openReviewBrowser(bootstrapUrl, {
      platform: "linux",
      spawn,
    })).rejects.toMatchObject({
      code: "REVIEW_BROWSER_OPEN_FAILED",
    });
  });

  it.each([
    `https://127.0.0.1:43123/?bootstrap=${"a".repeat(64)}`,
    `http://example.test:43123/?bootstrap=${"a".repeat(64)}`,
    "http://127.0.0.1:43123/",
    "http://127.0.0.1:43123/?bootstrap=short",
    `http://127.0.0.1:43123/other?bootstrap=${"a".repeat(64)}`,
    `http://user@127.0.0.1:43123/?bootstrap=${"a".repeat(64)}`,
    `http://127.0.0.1:43123/?bootstrap=${"a".repeat(64)}&next=evil`,
  ])("rejects a URL that is not the server bootstrap shape: %s", async (url) => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawn = vi.fn(() => child);

    await expect(openReviewBrowser(url, {
      platform: "linux",
      spawn,
    })).rejects.toMatchObject({
      code: "REVIEW_BROWSER_URL_REJECTED",
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe("runVisualMetadataReviewer", () => {
  const build = async () => fakeBuildResult();

  it("permits the identity-form fallback without logging or retaining the submitted email", async () => {
    const logs: string[] = [];
    let serverOptions: VisualMetadataReviewServerOptions | undefined;
    let openedConfig: ReviewWorkspaceConfig | undefined;
    const underlyingWorkspace = makeWorkspace(vi.fn(async () => undefined));
    const run = await runVisualMetadataReviewer({
      argv: REQUIRED_PATH_ARGS,
      environment: {},
      build,
      openBrowser: vi.fn(async () => undefined),
      registerSignal: () => vi.fn(),
      log: (message) => logs.push(message),
      openWorkspace: vi.fn(async (config) => {
        openedConfig = config;
        return underlyingWorkspace;
      }),
      startServer: vi.fn(async (options) => {
        serverOptions = options;
        return {
          bootstrapUrl: `http://127.0.0.1:43123/?bootstrap=${"a".repeat(64)}`,
          origin: "http://127.0.0.1:43123",
          close: vi.fn(async () => undefined),
        };
      }),
    });

    expect(run.mode).toBe("review");
    if (run.mode !== "review") throw new Error("expected review mode");
    expect(serverOptions?.workspace).toBeUndefined();
    expect(serverOptions?.workspaceFactory).toBeTypeOf("function");
    const workspace = await serverOptions!.workspaceFactory!({
      name: "Local Reviewer",
      email: "private@example.test",
    });
    expect(openedConfig?.reviewer).toEqual({
      name: "Local Reviewer",
      email: "private@example.test",
    });
    expect(logs).toEqual(["origin=http://127.0.0.1:43123"]);
    expect(JSON.stringify({ run, logs })).not.toContain("private@example.test");

    await run.close();
    await workspace.close();
  });

  it("supports no-open and closes the server before the workspace exactly once across both signals", async () => {
    const order: string[] = [];
    const workspaceClose = vi.fn(async () => {
      order.push("workspace");
    });
    const workspace = makeWorkspace(workspaceClose);
    let passedWorkspace: VisualMetadataReviewWorkspace | undefined;
    const serverClose = vi.fn(async () => {
      order.push("server");
      await passedWorkspace!.close();
    });
    const handlers = new Map<ReviewSignal, () => void>();
    const removeListeners: string[] = [];
    const openBrowser = vi.fn(async () => undefined);

    const run = await runVisualMetadataReviewer({
      argv: [
        ...REQUIRED_PATH_ARGS,
        "--reviewer-name", "Runtime Reviewer",
        "--reviewer-email", "runtime@example.test",
        "--no-open",
      ],
      environment: {},
      build,
      openBrowser,
      openWorkspace: vi.fn(async () => workspace),
      startServer: vi.fn(async (options): Promise<RunningReviewServer> => {
        passedWorkspace = options.workspace;
        return {
          bootstrapUrl: `http://127.0.0.1:43123/?bootstrap=${"a".repeat(64)}`,
          origin: "http://127.0.0.1:43123",
          close: serverClose,
        };
      }),
      registerSignal: (signal, handler) => {
        handlers.set(signal, handler);
        return () => {
          handlers.delete(signal);
          removeListeners.push(signal);
        };
      },
      log: vi.fn(),
    });

    if (run.mode !== "review") throw new Error("expected review mode");
    expect(openBrowser).not.toHaveBeenCalled();
    handlers.get("SIGINT")!();
    handlers.get("SIGTERM")?.();
    await run.close();

    expect(serverClose).toHaveBeenCalledOnce();
    expect(workspaceClose).toHaveBeenCalledOnce();
    expect(order).toEqual(["server", "workspace"]);
    expect(removeListeners.sort()).toEqual(["SIGINT", "SIGTERM"]);
  });

  it("rejects a bootstrap URL that does not belong to the server origin even with no-open", async () => {
    const logs: string[] = [];
    const workspaceClose = vi.fn(async () => undefined);
    const workspace = makeWorkspace(workspaceClose);
    const serverClose = vi.fn(async () => undefined);

    await expect(runVisualMetadataReviewer({
      argv: [
        ...REQUIRED_PATH_ARGS,
        "--reviewer-name", "Runtime Reviewer",
        "--reviewer-email", "runtime@example.test",
        "--no-open",
      ],
      environment: {},
      build,
      openWorkspace: vi.fn(async () => workspace),
      startServer: vi.fn(async () => ({
        bootstrapUrl: `http://127.0.0.1:43123/?bootstrap=${"a".repeat(64)}`,
        origin: "http://127.0.0.1:43124",
        close: serverClose,
      })),
      registerSignal: () => vi.fn(),
      log: (message) => logs.push(message),
    })).rejects.toMatchObject({
      code: "REVIEW_BROWSER_URL_REJECTED",
    });

    expect(serverClose).toHaveBeenCalledOnce();
    expect(workspaceClose).toHaveBeenCalledOnce();
    expect(logs).toEqual([]);
  });

  it("validates only the input and prints only safe aggregate counts without any launch side effect", async () => {
    const logs: string[] = [];
    const loadSource = vi.fn(async () => makeLoadedSource());
    const forbidden = () => {
      throw new Error("validate-only launch side effect");
    };

    const run = await runVisualMetadataReviewer({
      argv: ["--input", "scratch/source.json", "--validate-only"],
      environment: {},
      loadSource,
      build: forbidden,
      openBrowser: forbidden,
      openWorkspace: forbidden,
      startServer: forbidden,
      registerSignal: forbidden,
      log: (message) => logs.push(message),
    });

    expect(run).toEqual({
      mode: "validate-only",
      counts: makeLoadedSource().counts,
    });
    expect(loadSource).toHaveBeenCalledWith("scratch/source.json");
    expect(logs).toEqual([
      "rows=20 unique=20 suggested=19 failed=1 requiredApprovals=19 decisions=0",
    ]);
  });
});
