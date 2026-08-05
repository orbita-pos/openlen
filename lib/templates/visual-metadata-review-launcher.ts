import { spawn as nodeSpawn } from "node:child_process";
import { extname, resolve } from "node:path";
import type { BuildOptions, BuildResult } from "esbuild";
import {
  startVisualMetadataReviewServer,
  type ReviewClientAssets,
  type RunningReviewServer,
  type VisualMetadataReviewServerOptions,
} from "./visual-metadata-review-server";
import {
  loadVisualMetadataReviewSource,
  openVisualMetadataReviewWorkspace,
  type LoadedReviewSource,
  type ReviewWorkspaceConfig,
  type VisualMetadataReviewWorkspace,
} from "./visual-metadata-review-session-store";

const VALUE_FLAGS = new Set([
  "--input",
  "--session",
  "--reviewed-out",
  "--audit-out",
  "--reviewer-name",
  "--reviewer-email",
]);
const BOOLEAN_FLAGS = new Set(["--no-open", "--validate-only"]);
const BOOTSTRAP_TOKEN = /^[0-9a-f]{64}$/;

export type ReviewSignal = "SIGINT" | "SIGTERM";

export type ReviewLauncherErrorCode =
  | "REVIEW_LAUNCH_ARGUMENTS_INVALID"
  | "REVIEW_SOURCE_VALIDATION_FAILED"
  | "REVIEW_CLIENT_BUILD_FAILED"
  | "REVIEW_BROWSER_URL_REJECTED"
  | "REVIEW_BROWSER_OPEN_FAILED"
  | "REVIEW_WORKSPACE_OPEN_FAILED"
  | "REVIEW_SERVER_START_FAILED"
  | "REVIEW_LAUNCH_SHUTDOWN_FAILED";

export class VisualMetadataReviewLauncherError extends Error {
  readonly code: ReviewLauncherErrorCode;

  constructor(code: ReviewLauncherErrorCode) {
    super(code.toLocaleLowerCase());
    this.name = "VisualMetadataReviewLauncherError";
    this.code = code;
    this.stack = `${this.name}: ${this.message}`;
  }
}

interface ReviewCliBase {
  inputPath: string;
  noOpen: boolean;
  reviewer: { name: string; email: string } | undefined;
}

export interface ValidateReviewCliArgs extends ReviewCliBase {
  validateOnly: true;
}

export interface LaunchReviewCliArgs extends ReviewCliBase {
  validateOnly: false;
  sessionPath: string;
  reviewedOutputPath: string;
  auditOutputPath: string;
}

export type ParsedReviewCliArgs = ValidateReviewCliArgs | LaunchReviewCliArgs;

type Environment = Readonly<Record<string, string | undefined>>;
type EsbuildBuild = (options: BuildOptions) => Promise<BuildResult>;
type BrowserChild = {
  once(event: "spawn", listener: () => void): BrowserChild;
  once(event: "error", listener: (error: Error) => void): BrowserChild;
  off(event: "spawn", listener: () => void): BrowserChild;
  off(event: "error", listener: (error: Error) => void): BrowserChild;
  unref(): void;
};
type BrowserSpawn = (
  executable: string,
  args: readonly string[],
  options: { detached: true; stdio: "ignore"; windowsHide: true },
) => BrowserChild;

export interface BuildReviewClientAssetsOptions {
  build?: EsbuildBuild;
  cwd?: string;
}

export interface OpenReviewBrowserOptions {
  platform?: NodeJS.Platform;
  spawn?: BrowserSpawn;
}

export interface VisualMetadataReviewerLauncherDependencies {
  argv?: readonly string[];
  environment?: Environment;
  cwd?: string;
  build?: EsbuildBuild;
  loadSource?: (inputPath: string) => Promise<LoadedReviewSource>;
  openWorkspace?: (config: ReviewWorkspaceConfig) => Promise<VisualMetadataReviewWorkspace>;
  startServer?: (options: VisualMetadataReviewServerOptions) => Promise<RunningReviewServer>;
  openBrowser?: (bootstrapUrl: string) => Promise<void>;
  registerSignal?: (signal: ReviewSignal, handler: () => void) => () => void;
  log?: (message: string) => void;
  setExitCode?: (code: number) => void;
}

export type VisualMetadataReviewerRun =
  | {
      mode: "validate-only";
      counts: LoadedReviewSource["counts"];
    }
  | {
      mode: "review";
      origin: string;
      close(): Promise<void>;
    };

function invalidArguments(): never {
  throw new VisualMetadataReviewLauncherError("REVIEW_LAUNCH_ARGUMENTS_INVALID");
}

function validEmail(value: string): boolean {
  return value.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseFlags(argv: readonly string[]): {
  values: Map<string, string>;
  booleans: Set<string>;
} {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (BOOLEAN_FLAGS.has(flag)) {
      if (booleans.has(flag)) invalidArguments();
      booleans.add(flag);
      continue;
    }
    if (!VALUE_FLAGS.has(flag) || values.has(flag)) invalidArguments();
    const value = argv[index + 1]?.trim();
    if (!value || value.startsWith("--")) invalidArguments();
    values.set(flag, value);
    index += 1;
  }
  return { values, booleans };
}

function resolveReviewer(
  values: ReadonlyMap<string, string>,
  environment: Environment,
): { name: string; email: string } | undefined {
  const flagName = values.get("--reviewer-name");
  const flagEmail = values.get("--reviewer-email");
  if ((flagName === undefined) !== (flagEmail === undefined)) invalidArguments();
  if (flagName !== undefined && flagEmail !== undefined) {
    if (flagName.length > 200 || !validEmail(flagEmail)) invalidArguments();
    return { name: flagName, email: flagEmail };
  }

  const environmentName = environment.OPENLEN_REVIEWER_NAME?.trim();
  const environmentEmail = environment.OPENLEN_REVIEWER_EMAIL?.trim();
  const hasEnvironmentName = Boolean(environmentName);
  const hasEnvironmentEmail = Boolean(environmentEmail);
  if (hasEnvironmentName !== hasEnvironmentEmail) invalidArguments();
  if (environmentName && environmentEmail) {
    if (environmentName.length > 200 || !validEmail(environmentEmail)) invalidArguments();
    return { name: environmentName, email: environmentEmail };
  }
  return undefined;
}

export function parseReviewCliArgs(
  argv: readonly string[],
  environment: Environment = {},
): ParsedReviewCliArgs {
  const { values, booleans } = parseFlags(argv);
  const inputPath = values.get("--input");
  if (!inputPath) invalidArguments();
  const noOpen = booleans.has("--no-open");
  if (booleans.has("--validate-only")) {
    return {
      inputPath,
      validateOnly: true,
      noOpen,
      reviewer: undefined,
    };
  }

  const reviewer = resolveReviewer(values, environment);
  const sessionPath = values.get("--session");
  const reviewedOutputPath = values.get("--reviewed-out");
  const auditOutputPath = values.get("--audit-out");
  if (!sessionPath || !reviewedOutputPath || !auditOutputPath) invalidArguments();
  return {
    inputPath,
    sessionPath,
    reviewedOutputPath,
    auditOutputPath,
    validateOnly: false,
    noOpen,
    reviewer,
  };
}

function wrapLauncherError(error: unknown, code: ReviewLauncherErrorCode): VisualMetadataReviewLauncherError {
  return error instanceof VisualMetadataReviewLauncherError
    ? error
    : new VisualMetadataReviewLauncherError(code);
}

export async function buildReviewClientAssets(
  options: BuildReviewClientAssetsOptions = {},
): Promise<ReviewClientAssets> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const build = options.build ?? (async (buildOptions: BuildOptions) => {
    const esbuild = await import("esbuild");
    return esbuild.build(buildOptions);
  });
  let result: BuildResult;
  try {
    result = await build({
      entryPoints: [resolve(cwd, "tools/template-visual-metadata-reviewer/app.tsx")],
      outdir: resolve(cwd, ".openlen-review-client"),
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: {
        "process.env.NODE_ENV": "\"production\"",
      },
      logLevel: "silent",
    });
  } catch (error) {
    throw wrapLauncherError(error, "REVIEW_CLIENT_BUILD_FAILED");
  }

  const outputFiles = result.outputFiles ?? [];
  const javascript = outputFiles.filter((file) => extname(file.path).toLocaleLowerCase() === ".js");
  const css = outputFiles.filter((file) => extname(file.path).toLocaleLowerCase() === ".css");
  if (javascript.length !== 1 || css.length !== 1 || !javascript[0].text || !css[0].text) {
    throw new VisualMetadataReviewLauncherError("REVIEW_CLIENT_BUILD_FAILED");
  }
  return {
    javascript: javascript[0].text,
    css: css[0].text,
  };
}

function validatedBootstrapUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new VisualMetadataReviewLauncherError("REVIEW_BROWSER_URL_REJECTED");
  }
  const bootstrapValues = url.searchParams.getAll("bootstrap");
  if (url.protocol !== "http:"
    || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    || !url.port
    || url.pathname !== "/"
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
    || url.searchParams.size !== 1
    || bootstrapValues.length !== 1
    || !BOOTSTRAP_TOKEN.test(bootstrapValues[0])) {
    throw new VisualMetadataReviewLauncherError("REVIEW_BROWSER_URL_REJECTED");
  }
  return url.toString();
}

function validatedServerBootstrapUrl(bootstrapUrl: string, origin: string): string {
  const safeBootstrapUrl = validatedBootstrapUrl(bootstrapUrl);
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new VisualMetadataReviewLauncherError("REVIEW_BROWSER_URL_REJECTED");
  }
  if (parsedOrigin.origin !== origin
    || parsedOrigin.pathname !== "/"
    || parsedOrigin.search !== ""
    || parsedOrigin.hash !== ""
    || parsedOrigin.username !== ""
    || parsedOrigin.password !== ""
    || new URL(safeBootstrapUrl).origin !== origin) {
    throw new VisualMetadataReviewLauncherError("REVIEW_BROWSER_URL_REJECTED");
  }
  return safeBootstrapUrl;
}

export async function openReviewBrowser(
  bootstrapUrl: string,
  options: OpenReviewBrowserOptions = {},
): Promise<void> {
  const safeUrl = validatedBootstrapUrl(bootstrapUrl);
  const platform = options.platform ?? process.platform;
  let executable: string;
  let args: readonly string[];
  if (platform === "win32") {
    executable = "rundll32.exe";
    args = ["url.dll,FileProtocolHandler", safeUrl];
  } else if (platform === "darwin") {
    executable = "open";
    args = [safeUrl];
  } else if (platform === "linux") {
    executable = "xdg-open";
    args = [safeUrl];
  } else {
    throw new VisualMetadataReviewLauncherError("REVIEW_BROWSER_OPEN_FAILED");
  }

  try {
    const child = (options.spawn ?? (nodeSpawn as unknown as BrowserSpawn))(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onSpawn = () => {
        child.off("error", onError);
        child.unref();
        resolvePromise();
      };
      const onError = () => {
        child.off("spawn", onSpawn);
        rejectPromise(new VisualMetadataReviewLauncherError("REVIEW_BROWSER_OPEN_FAILED"));
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });
  } catch (error) {
    throw wrapLauncherError(error, "REVIEW_BROWSER_OPEN_FAILED");
  }
}

function closeOnce(workspace: VisualMetadataReviewWorkspace): VisualMetadataReviewWorkspace {
  let closePromise: Promise<void> | null = null;
  return {
    ...workspace,
    close() {
      if (!closePromise) closePromise = workspace.close();
      return closePromise;
    },
  };
}

function defaultSignalRegistrar(signal: ReviewSignal, handler: () => void): () => void {
  process.once(signal, handler);
  return () => process.off(signal, handler);
}

function safeCountsLine(counts: LoadedReviewSource["counts"]): string {
  return `rows=${counts.rows} unique=${counts.unique} suggested=${counts.suggested} failed=${counts.failed} requiredApprovals=${counts.requiredApprovals} decisions=0`;
}

export async function runVisualMetadataReviewer(
  dependencies: VisualMetadataReviewerLauncherDependencies = {},
): Promise<VisualMetadataReviewerRun> {
  const args = parseReviewCliArgs(
    dependencies.argv ?? process.argv.slice(2),
    dependencies.environment ?? process.env,
  );
  const log = dependencies.log ?? ((message: string) => console.log(message));
  const loadSource = dependencies.loadSource ?? loadVisualMetadataReviewSource;
  if (args.validateOnly) {
    let source: LoadedReviewSource;
    try {
      source = await loadSource(args.inputPath);
    } catch (error) {
      throw wrapLauncherError(error, "REVIEW_SOURCE_VALIDATION_FAILED");
    }
    log(safeCountsLine(source.counts));
    return { mode: "validate-only", counts: structuredClone(source.counts) };
  }

  const openWorkspace = dependencies.openWorkspace ?? openVisualMetadataReviewWorkspace;
  const startServer = dependencies.startServer ?? startVisualMetadataReviewServer;
  const openBrowser = dependencies.openBrowser ?? openReviewBrowser;
  const registerSignal = dependencies.registerSignal ?? defaultSignalRegistrar;
  const setExitCode = dependencies.setExitCode ?? ((code: number) => {
    process.exitCode = code;
  });
  const assets = await buildReviewClientAssets({
    build: dependencies.build,
    cwd: dependencies.cwd,
  });

  let activeWorkspace: VisualMetadataReviewWorkspace | undefined;
  const openTrackedWorkspace = async (
    reviewer: { name: string; email: string },
  ): Promise<VisualMetadataReviewWorkspace> => {
    try {
      const workspace = await openWorkspace({
        inputPath: args.inputPath,
        sessionPath: args.sessionPath,
        reviewedOutputPath: args.reviewedOutputPath,
        auditOutputPath: args.auditOutputPath,
        reviewer,
      });
      const tracked = closeOnce(workspace);
      activeWorkspace = tracked;
      return tracked;
    } catch (error) {
      throw wrapLauncherError(error, "REVIEW_WORKSPACE_OPEN_FAILED");
    }
  };

  if (args.reviewer) activeWorkspace = await openTrackedWorkspace(args.reviewer);
  let server: RunningReviewServer;
  try {
    server = await startServer(args.reviewer
      ? { workspace: activeWorkspace, assets }
      : { workspaceFactory: openTrackedWorkspace, assets });
  } catch (error) {
    try {
      await activeWorkspace?.close();
    } catch {
      throw new VisualMetadataReviewLauncherError("REVIEW_LAUNCH_SHUTDOWN_FAILED");
    }
    throw wrapLauncherError(error, "REVIEW_SERVER_START_FAILED");
  }

  let shutdownPromise: Promise<void> | null = null;
  const removeSignalListeners: Array<() => void> = [];
  const close = (): Promise<void> => {
    if (!shutdownPromise) {
      for (const remove of removeSignalListeners.splice(0)) remove();
      shutdownPromise = (async () => {
        try {
          await server.close();
        } finally {
          await activeWorkspace?.close();
        }
      })();
    }
    return shutdownPromise;
  };
  const handleSignal = () => {
    void close().catch(() => {
      log("error=REVIEW_LAUNCH_SHUTDOWN_FAILED");
      setExitCode(1);
    });
  };
  let safeBootstrapUrl: string;
  try {
    safeBootstrapUrl = validatedServerBootstrapUrl(server.bootstrapUrl, server.origin);
  } catch (error) {
    try {
      await close();
    } catch {
      throw new VisualMetadataReviewLauncherError("REVIEW_LAUNCH_SHUTDOWN_FAILED");
    }
    throw wrapLauncherError(error, "REVIEW_BROWSER_URL_REJECTED");
  }
  removeSignalListeners.push(registerSignal("SIGINT", handleSignal));
  removeSignalListeners.push(registerSignal("SIGTERM", handleSignal));

  try {
    if (!args.noOpen) await openBrowser(safeBootstrapUrl);
  } catch (error) {
    try {
      await close();
    } catch {
      throw new VisualMetadataReviewLauncherError("REVIEW_LAUNCH_SHUTDOWN_FAILED");
    }
    throw wrapLauncherError(error, "REVIEW_BROWSER_OPEN_FAILED");
  }
  log(`origin=${server.origin}`);
  return {
    mode: "review",
    origin: server.origin,
    close,
  };
}
