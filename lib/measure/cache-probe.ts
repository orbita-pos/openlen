// THE CACHE PROBE (spec local 2026-11-13-conversar-todo-el-mes, §8.1): how long does DeepInfra keep a prompt
// cached for Len's model? Its documentation says «entries expire after a period of inactivity» and gives no
// number; the 65 minutes after which a turn counted as cold (lib/agent/cold-return.ts) were Claude Code's, read
// off ITS provider. This sends eight prefixes of about 30.000 tokens, each under its own cache key, and sends
// each one again exactly once after 15, 30, 45, 60, 75, 90, 120 and 180 minutes: how much of the second call
// came back cached says whether the entry was still there. A read may refresh an entry, which is why every
// prefix is looked at only once. Whether it does is what the REFRESH PLAN asks (`PROBE_REFRESH_PLAN`,
// `--plan=refresh`, 24/11/2026): it was assumed here and never measured.
//
// One addition to the spec's sixteen calls: a ninth prefix sent again after ONE minute. Without it, eight
// misses could mean «it expires in under 15 minutes» or «nothing was cached at all» (a key that gave no
// affinity, a prefix under the provider's minimum) and the probe could not tell them apart.
//
// Everything here is pure: the runner (scripts/measure/cache-probe.ts) does the calls and the waiting.

/** Minutes after which each prefix is sent again (spec §8.1). */
export const PROBE_DELAYS_MIN = [15, 30, 45, 60, 75, 90, 120, 180] as const;
/** The control: sent again while any cache must still be there. */
export const PROBE_CONTROL_MIN = 1;
/** Words in a prefix. Short common words run close to one token each; with the ceiling below, 30.000 tokens. */
export const PROBE_PREFIX_WORDS = 23_000;
/** The most tokens a word of the list can cost: what the budget counts before the provider reports a size. */
export const PROBE_TOKENS_PER_WORD_MAX = 1.3;
/** The answer is one word; this is what the request allows. */
export const PROBE_MAX_OUTPUT_TOKENS = 64;
export const PROBE_CAP_USD_DEFAULT = 0.15;
/** DeepInfra's list price for Len's model, per million tokens, WITHOUT its promotion (spec §8): the cap is
 *  counted with the dearer figure, so a promotion that ends mid-probe cannot push it over. */
export const PROBE_LIST_PRICE = Object.freeze({ input: 0.2, cached: 0.006, output: 0.6 });
/** From this share of the prefix read from the cache, the entry was there; under the lower one, it was gone. */
export const PROBE_WARM_FROM = 0.8;
export const PROBE_COLD_UNDER = 0.2;

export interface ProbeCall {
  /** ISO: when the call was sent. */
  readonly at: string;
  readonly inputTokens: number;
  /** A subset of `inputTokens`. */
  readonly cachedTokens: number;
  readonly outputTokens: number;
  readonly ms: number;
  /** The call failed; its numbers are zeros. */
  readonly error?: string;
}

export interface ProbeEntry {
  readonly id: string;
  /** Its own cache key and, with the run's id, its own text. */
  readonly cacheKey: string;
  readonly index: number;
  readonly delayMin: number;
  first: ProbeCall | null;
  second: ProbeCall | null;
  /** ISO: when the second call was about to be sent — written down BEFORE sending it. A read refreshes the
   *  entry, so a second call that was cut (the runner was killed) is never sent again: its answer would say
   *  «still cached» because of the first try. */
  secondAttemptedAt?: string;
  /** THE REFRESH PLAN: minutes after the first call when this prefix is read once in the middle, before its
   *  second call. Absent = never. */
  readonly refreshMin?: number;
  /** That read in the middle, and when it was about to be sent (written down first, like the second call). */
  refresh?: ProbeCall | null;
  refreshAttemptedAt?: string;
}

/** What the runner saves after every call: a probe that is killed goes on from here. */
export interface ProbeState {
  readonly v: 1;
  readonly runId: string;
  readonly model: string;
  readonly entries: ProbeEntry[];
  /** `refresh`: the refresh plan (`PROBE_REFRESH_PLAN`). Absent: how long the cache lives (the delays). */
  readonly plan?: "refresh";
}

/** THE REFRESH PLAN (24/11/2026): does a READ keep DeepInfra's entry alive? This probe's header assumed so and
 *  never measured it; Hermes Agent keeps a chat's cache warm on that assumption. The control; two prefixes read at
 *  40 and again at 80; one read at 40 and again at 100; and two left untouched until 80, the control of the expiry
 *  measured on 14/11 (cached at 45, gone at 60). */
export const PROBE_REFRESH_PLAN: readonly { readonly delayMin: number; readonly refreshMin?: number }[] = [
  { delayMin: PROBE_CONTROL_MIN },
  { delayMin: 80, refreshMin: 40 },
  { delayMin: 80, refreshMin: 40 },
  { delayMin: 100, refreshMin: 40 },
  { delayMin: 80 },
  { delayMin: 80 },
];

export function newProbeState(runId: string, model: string, plan?: "refresh"): ProbeState {
  const shape: readonly { readonly delayMin: number; readonly refreshMin?: number }[] =
    plan === "refresh" ? PROBE_REFRESH_PLAN : [PROBE_CONTROL_MIN, ...PROBE_DELAYS_MIN].map((delayMin) => ({ delayMin }));
  return {
    v: 1,
    runId,
    model,
    ...(plan ? { plan } : {}),
    entries: shape.map((s, index) => ({
      id: `p${index}`,
      cacheKey: `cache-probe-${runId}-${index}`,
      index,
      delayMin: s.delayMin,
      first: null,
      second: null,
      ...(s.refreshMin !== undefined ? { refreshMin: s.refreshMin, refresh: null } : {}),
    })),
  };
}

// Short everyday words: a prefix made of them is ordinary text to a tokenizer.
const WORDS =
  "the of and to in is that it was for on are with as his they be at one have this from or had by hot but some what there we can out other were all your when up use word how said an each she which do their time if will way about many then them would write like so these her long make thing see him two has look more day could go come did my sound no most number who over know water than call first people may down side been now find any new work part take get place made live where after back little only round man year came show every good me give our under name very through just form much great think say help low line before turn cause same mean differ move right boy old too does tell sentence set three want air well also play small end put home read hand port large spell add even land here must big high such follow act why ask men change went light kind off need house picture try us again animal point mother world near build self earth father head stand own page should country found answer school grow study still learn plant cover food sun four thought let keep eye never last door between city tree cross since hard start might story saw far sea draw left late run while press close night real life few stop".split(
    " ",
  );

/** FNV-1a: a seed out of a name, the same on every machine. */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The text of one prefix: the same every time for a run and an index, and different from its very first
 *  words from every other — a provider's cache matches from the start of the prompt. */
export function probeText(runId: string, index: number): string {
  const next = mulberry32(seedOf(`${runId}:${index}`));
  const words: string[] = [`Probe ${runId} number ${index} ${seedOf(`${index}:${runId}`).toString(36)}.`];
  for (let i = 0; i < PROBE_PREFIX_WORDS; i++) words.push(WORDS[Math.floor(next() * WORDS.length)]!);
  return words.join(" ");
}

export type ProbeAction =
  | { readonly kind: "first"; readonly entry: ProbeEntry }
  | { readonly kind: "refresh"; readonly entry: ProbeEntry }
  | { readonly kind: "second"; readonly entry: ProbeEntry }
  | { readonly kind: "wait"; readonly untilMs: number }
  | { readonly kind: "done" };

const answeredFirst = (entry: ProbeEntry): boolean => entry.first !== null && !entry.first.error;
const dueAt = (entry: ProbeEntry, minutes: number): number => Date.parse(entry.first!.at) + minutes * 60_000;
/** Its read in the middle is still to be sent. */
const refreshPending = (entry: ProbeEntry): boolean => entry.refreshMin !== undefined && !entry.refresh && !entry.refreshAttemptedAt;

/** What the runner does now: every prefix once, then each again when its own delay has passed — after its read in
 *  the middle, if it has one. A call that is overdue (the runner was down) is sent at once and reported with the
 *  delay that really passed. */
export function nextAction(state: ProbeState, nowMs: number): ProbeAction {
  const unsent = state.entries.find((entry) => entry.first === null);
  if (unsent) return { kind: "first", entry: unsent };
  const pending = state.entries
    .filter((entry) => answeredFirst(entry) && entry.second === null && !entry.secondAttemptedAt)
    .map((entry) =>
      refreshPending(entry)
        ? { kind: "refresh" as const, entry, due: dueAt(entry, entry.refreshMin!) }
        : { kind: "second" as const, entry, due: dueAt(entry, entry.delayMin) },
    )
    .sort((a, b) => a.due - b.due);
  const next = pending[0];
  if (!next) return { kind: "done" };
  return next.due <= nowMs ? { kind: next.kind, entry: next.entry } : { kind: "wait", untilMs: next.due };
}

const PER_TOKEN = 1e-6;

export function callCostUsd(call: Pick<ProbeCall, "inputTokens" | "cachedTokens" | "outputTokens">, price = PROBE_LIST_PRICE): number {
  const cached = Math.min(call.cachedTokens, call.inputTokens);
  return ((call.inputTokens - cached) * price.input + cached * price.cached + call.outputTokens * price.output) * PER_TOKEN;
}

export function spentUsd(state: ProbeState): number {
  return state.entries.reduce(
    (sum, entry) => sum + (entry.first ? callCostUsd(entry.first) : 0) + (entry.refresh ? callCostUsd(entry.refresh) : 0) + (entry.second ? callCostUsd(entry.second) : 0),
    0,
  );
}

/** The size the budget counts for a prefix: the largest the provider has reported so far, or the ceiling. */
function prefixTokens(state: ProbeState): number {
  const reported = Math.max(0, ...state.entries.flatMap((entry) => [entry.first?.inputTokens ?? 0, entry.refresh?.inputTokens ?? 0, entry.second?.inputTokens ?? 0]));
  return reported > 0 ? reported : Math.ceil(PROBE_PREFIX_WORDS * PROBE_TOKENS_PER_WORD_MAX);
}

/** What the calls still to make would cost if NONE came back cached and each wrote all it is allowed to. */
export function worstCaseRemainingUsd(state: ProbeState): number {
  const left = state.entries.reduce((n, entry) => {
    const middle = refreshPending(entry) ? 1 : 0;
    if (entry.first === null) return n + 2 + middle;
    return n + (answeredFirst(entry) && entry.second === null && !entry.secondAttemptedAt ? 1 + middle : 0);
  }, 0);
  return left * callCostUsd({ inputTokens: prefixTokens(state), cachedTokens: 0, outputTokens: PROBE_MAX_OUTPUT_TOKENS });
}

/** Whether everything left fits under the cap, counted at its worst. Asked before EVERY call. */
export function fits(state: ProbeState, capUsd: number): boolean {
  return spentUsd(state) + worstCaseRemainingUsd(state) <= capUsd + 1e-9;
}

/** How much of a call's prompt the provider read from its cache, 0 to 1. */
export function hitShare(call: Pick<ProbeCall, "inputTokens" | "cachedTokens">): number {
  return call.inputTokens > 0 ? Math.min(call.cachedTokens, call.inputTokens) / call.inputTokens : 0;
}

export type ProbeVerdict = "warm" | "cold" | "partial" | "failed" | "pending";

export interface ProbeRow {
  readonly id: string;
  readonly delayMin: number;
  /** Minutes that really passed between the two calls, rounded. */
  readonly actualMin: number | null;
  readonly share: number | null;
  readonly verdict: ProbeVerdict;
}

export interface ProbeReport {
  readonly rows: readonly ProbeRow[];
  /** The control came back cached: the probe can speak. */
  readonly controlOk: boolean;
  /** Every delay was sent again, on time (within two minutes of its plan). */
  readonly complete: boolean;
  /** The longest delay found cached with every shorter one cached too; `null` = none, or the control failed. */
  readonly lastWarmMin: number | null;
  /** The first delay NOT found cached. */
  readonly firstColdMin: number | null;
  /** Hits, then misses, nothing mixed: the boundary can be read. */
  readonly clean: boolean;
  readonly spentUsd: number;
  readonly lines: readonly string[];
  /** THE REFRESH PLAN's answer: whether a read in the middle kept the entry alive past its expiry. */
  readonly refresh?: RefreshVerdict;
}

/** `refreshes`: the prefixes read at 40 were cached at 80 and the untouched ones were not. `does_not_refresh`: read
 *  or not, gone at 80. `cannot_tell`: an untouched one was still cached at 80. `mixed`: the arms disagree within
 *  themselves. `no_reading`: the control failed, or a call is missing. */
export type RefreshVerdict = "refreshes" | "does_not_refresh" | "cannot_tell" | "mixed" | "no_reading";

const isWarm = (c: ProbeCall | null | undefined): boolean => !!c && !c.error && hitShare(c) >= PROBE_WARM_FROM;
const isCold = (c: ProbeCall | null | undefined): boolean => !!c && !c.error && hitShare(c) < PROBE_COLD_UNDER;
const shareText = (c: ProbeCall | null | undefined): string => (!c ? "—" : c.error ? "failed" : `${(hitShare(c) * 100).toFixed(0)}%`);

function refreshReading(state: ProbeState, controlOk: boolean): { verdict: RefreshVerdict; lines: string[] } {
  const read = state.entries.filter((e) => e.refreshMin !== undefined && e.delayMin === 80);
  const untouched = state.entries.filter((e) => e.refreshMin === undefined && e.delayMin === 80);
  const later = state.entries.filter((e) => e.refreshMin !== undefined && e.delayMin !== 80);
  const lines = [
    ...read.map((e) => `${e.id}  read at ${e.refreshMin}: ${shareText(e.refresh)} · at ${e.delayMin}: ${shareText(e.second)}`),
    ...later.map((e) => `${e.id}  read at ${e.refreshMin}: ${shareText(e.refresh)} · at ${e.delayMin}: ${shareText(e.second)} (${e.delayMin - e.refreshMin!} minutes after the read)`),
    ...untouched.map((e) => `${e.id}  untouched · at ${e.delayMin}: ${shareText(e.second)}`),
  ];
  const complete = [...read, ...untouched].every((e) => e.second && !e.second.error) && read.every((e) => e.refresh && !e.refresh.error);
  let verdict: RefreshVerdict;
  if (!controlOk || !complete) verdict = "no_reading";
  else if (untouched.some((e) => isWarm(e.second))) verdict = "cannot_tell";
  else if (!untouched.every((e) => isCold(e.second))) verdict = "mixed";
  else if (read.every((e) => isWarm(e.refresh) && isWarm(e.second))) verdict = "refreshes";
  else if (read.every((e) => isCold(e.second))) verdict = "does_not_refresh";
  else verdict = "mixed";
  lines.push(
    {
      refreshes: "Yes: a read keeps the entry alive — the prefixes read at minute 40 were still cached at 80, the untouched ones were gone.",
      does_not_refresh: "No: a read does NOT keep the entry alive — read at 40 or not, it was gone at 80.",
      cannot_tell: "The untouched prefixes were still cached at 80 minutes: the cache lived longer than on 14/11, and this run can't tell whether a read keeps it alive.",
      mixed: "Mixed answers within an arm: with two prefixes per arm, a routing miss can't be told from an expiry. Run it again.",
      no_reading: "No reading: the control was not cached, or a call is missing.",
    }[verdict],
  );
  return { verdict, lines };
}

function rowOf(entry: ProbeEntry): ProbeRow {
  const base = { id: entry.id, delayMin: entry.delayMin };
  if (!entry.first || entry.first.error) return { ...base, actualMin: null, share: null, verdict: entry.first ? "failed" : "pending" };
  // Sent and never answered: it cannot be asked again, so this delay has no reading.
  if (!entry.second && entry.secondAttemptedAt) return { ...base, actualMin: null, share: null, verdict: "failed" };
  if (!entry.second) return { ...base, actualMin: null, share: null, verdict: "pending" };
  const actualMin = Math.round((Date.parse(entry.second.at) - Date.parse(entry.first.at)) / 60_000);
  if (entry.second.error) return { ...base, actualMin, share: null, verdict: "failed" };
  const share = hitShare(entry.second);
  return { ...base, actualMin, share, verdict: share >= PROBE_WARM_FROM ? "warm" : share < PROBE_COLD_UNDER ? "cold" : "partial" };
}

export function probeReport(state: ProbeState): ProbeReport {
  const rows = state.entries.map(rowOf);
  const control = rows.find((row) => row.delayMin === PROBE_CONTROL_MIN);
  const controlOk = control?.verdict === "warm";
  const delays = rows.filter((row) => row.delayMin !== PROBE_CONTROL_MIN).sort((a, b) => (a.actualMin ?? a.delayMin) - (b.actualMin ?? b.delayMin));
  const complete = delays.every((row) => row.actualMin !== null && row.verdict !== "failed" && Math.abs(row.actualMin - row.delayMin) <= 2);
  const firstNotWarm = delays.findIndex((row) => row.verdict !== "warm");
  const warmRun = firstNotWarm === -1 ? delays : delays.slice(0, firstNotWarm);
  const lastWarm = controlOk ? warmRun.at(-1) : undefined;
  const firstCold = controlOk && firstNotWarm !== -1 ? delays[firstNotWarm] : undefined;
  const clean = controlOk && (firstNotWarm === -1 || delays.slice(firstNotWarm).every((row) => row.verdict === "cold"));
  const minutes = (row: ProbeRow | undefined) => (row ? (row.actualMin ?? row.delayMin) : null);

  const lines = [
    `model ${state.model} · run ${state.runId} · spent $${spentUsd(state).toFixed(4)} at list price`,
    "delay  actual  cached  verdict",
    ...rows.map(
      (row) =>
        `${String(row.delayMin).padStart(4)}m  ${row.actualMin === null ? "    —" : `${String(row.actualMin).padStart(4)}m`}  ${row.share === null ? "    —" : `${(row.share * 100).toFixed(0).padStart(4)}%`}  ${row.verdict}${row.delayMin === PROBE_CONTROL_MIN ? " (control)" : ""}`,
    ),
  ];
  if (!controlOk) {
    lines.push("The control did not come back cached: this run says NOTHING about how long the cache lives (nothing was cached, or the key gave no affinity).");
  } else if (lastWarm === undefined) {
    lines.push(`Gone by ${minutes(firstCold)} minutes: no delay was found cached.`);
  } else if (firstCold === undefined) {
    lines.push(`Still cached at ${minutes(lastWarm)} minutes, the longest delay tried.`);
  } else {
    lines.push(`Cached up to ${minutes(lastWarm)} minutes; not at ${minutes(firstCold)}.${clean ? "" : " Hits and misses are MIXED after that: one prefix per delay cannot tell a routing miss from an expiry."}`);
  }
  if (!complete) lines.push("Not every delay was sent again on time: read the «actual» column, not the plan.");
  const base = { rows, controlOk, complete, lastWarmMin: minutes(lastWarm), firstColdMin: minutes(firstCold), clean, spentUsd: spentUsd(state) };
  if (state.plan !== "refresh") return { ...base, lines };
  // The refresh plan asks something else: its own lines replace the expiry's reading (the table stays).
  const reading = refreshReading(state, controlOk);
  return { ...base, lines: [...lines.slice(0, rows.length + 2), ...reading.lines], refresh: reading.verdict };
}

/** What the runner needs from the world: the call, the clock and where the state is kept. */
export interface ProbeDeps {
  send(entry: ProbeEntry, text: string): Promise<ProbeCall>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Called after EVERY call: a probe that dies has lost nothing it paid for. */
  save(state: ProbeState): void;
  log(line: string): void;
}

/** The longest the runner sleeps in one go: it wakes to say it is alive. */
const PROBE_SLEEP_MS = 5 * 60_000;

/** Runs the probe to its end, or stops before the call that could cross the cap (`cap`). */
export async function runProbe(state: ProbeState, capUsd: number, deps: ProbeDeps): Promise<"done" | "cap"> {
  for (;;) {
    const action = nextAction(state, deps.now());
    if (action.kind === "done") return "done";
    if (action.kind === "wait") {
      const ms = action.untilMs - deps.now();
      deps.log(`waiting ${Math.ceil(ms / 60_000)} min for the next prefix · spent $${spentUsd(state).toFixed(4)}`);
      await deps.sleep(Math.min(ms, PROBE_SLEEP_MS));
      continue;
    }
    if (!fits(state, capUsd)) {
      deps.log(`stopped: what is left could cost $${worstCaseRemainingUsd(state).toFixed(4)} on top of the $${spentUsd(state).toFixed(4)} spent, over the $${capUsd.toFixed(2)} cap`);
      return "cap";
    }
    const { entry } = action;
    // A read is written down BEFORE it is sent: one that was cut is never sent again (its answer would lie).
    if (action.kind === "second") {
      entry.secondAttemptedAt = new Date(deps.now()).toISOString();
      deps.save(state);
    } else if (action.kind === "refresh") {
      entry.refreshAttemptedAt = new Date(deps.now()).toISOString();
      deps.save(state);
    }
    const result = await deps.send(entry, probeText(state.runId, entry.index));
    if (action.kind === "first") entry.first = result;
    else if (action.kind === "refresh") entry.refresh = result;
    else entry.second = result;
    deps.save(state);
    const at = action.kind === "refresh" ? `${entry.refreshMin} min` : `${entry.delayMin} min`;
    deps.log(
      `${entry.id} ${action.kind} (${at})${result.error ? ` FAILED: ${result.error}` : ` · ${result.inputTokens} tokens, ${(hitShare(result) * 100).toFixed(0)}% cached, ${result.ms} ms`}`,
    );
  }
}
