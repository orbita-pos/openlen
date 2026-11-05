// scripts/games-box-check.ts
// Checks that a REAL box with the box's real closed network brings a game's CC0 assets the way the game-development
// skill says (spec local 2026-11-05-modo-juego-design, §8.5, §8.6, §10): a GLTF model and its buffer from Poly Haven
// (its API, with a User-Agent of our own, as its API terms ask), a texture pack from ambientCG (following its redirect
// to its download host), and — the control arm — that Kenney is NOT reachable (its site refuses scripts; the box
// doesn't allow it). Says OK/FAIL per check and kills the box.
//
// Needs E2B_API_KEY and the template built (npm run sandbox:template). Costs cents of E2B.
//
// Run: npm run games:box-check

import { SANDBOX_TEMPLATE } from "../lib/agent/sandbox/config";
import { BOX_ALLOW_OUT } from "../lib/agent/sandbox/e2b-driver";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "OK   " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
};

type Run = { exitCode: number; stdout: string; stderr: string };
type Box = {
  commands: { run(cmd: string, o?: { timeoutMs?: number }): Promise<Run> };
  files: { write(path: string, data: string | ArrayBuffer): Promise<unknown> };
  kill(): Promise<unknown>;
};

async function run(box: Box, cmd: string, timeoutMs = 180_000): Promise<Run> {
  try {
    return await box.commands.run(cmd, { timeoutMs });
  } catch (e) {
    const x = e as Partial<Run>;
    if (typeof x?.exitCode !== "number") throw e;
    return { exitCode: x.exitCode, stdout: String(x.stdout ?? ""), stderr: String(x.stderr ?? "") };
  }
}

const short = (r: Run) => `exit ${r.exitCode}: ${(r.stderr || r.stdout).trim().slice(-300)}`;
const D = "/tmp/games-check";
const UA = "OpenLen-game/1.0";

// Poly Haven, as the skill says: the API lists the asset's files; the .gltf and its buffer come from dl.polyhaven.org.
const POLYHAVEN_PY = `
import json, urllib.request
UA = {"User-Agent": "${UA}"}
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()
files = json.loads(get("https://api.polyhaven.com/files/Barrel_01"))
gltf = files["gltf"]["1k"]["gltf"]
model = get(gltf["url"])
include = next(iter(gltf.get("include", {}).values()), None)
buffer = get(include["url"]) if include else b""
print(json.dumps({"gltf_host": gltf["url"].split("/")[2], "gltf_bytes": len(model), "asset": json.loads(model).get("asset", {}).get("version"), "include_bytes": len(buffer)}))
`;

async function main() {
  const apiKey = process.env.E2B_API_KEY?.trim();
  if (!apiKey) throw new Error("E2B_API_KEY is not set");
  const { Sandbox } = await import("e2b");
  console.log(`box from ${SANDBOX_TEMPLATE}, with the box's closed network…`);
  // The same closed network the turns' boxes get (lib/agent/sandbox/e2b-driver.ts), without a project's hosts.
  const box = (await Sandbox.create(SANDBOX_TEMPLATE, {
    apiKey,
    timeoutMs: 10 * 60_000,
    network: { denyOut: ["0.0.0.0/0"], allowOut: [...BOX_ALLOW_OUT], allowPublicTraffic: false },
  } as unknown as Parameters<typeof Sandbox.create>[1])) as unknown as Box;
  try {
    await run(box, `mkdir -p ${D}`);

    await box.files.write(`${D}/polyhaven.py`, POLYHAVEN_PY);
    const ph = await run(box, `python3 ${D}/polyhaven.py`);
    const got = ph.exitCode === 0 ? (JSON.parse(ph.stdout.trim().split("\n").pop()!) as { gltf_host: string; gltf_bytes: number; asset: string; include_bytes: number }) : null;
    check(
      "Poly Haven: the API lists Barrel_01 and its 1k .gltf comes from dl.polyhaven.org, with its buffer",
      !!got && got.gltf_host === "dl.polyhaven.org" && got.asset === "2.0" && got.include_bytes > 10_000,
      got ? `gltf ${got.gltf_bytes} B (glTF ${got.asset}), buffer ${got.include_bytes} B` : short(ph),
    );

    const acg = await run(box, `curl -fsSL -A '${UA}' -o ${D}/bricks.zip 'https://ambientcg.com/get?file=Bricks001_1K-JPG.zip' && unzip -l ${D}/bricks.zip | tail -1`);
    check("ambientCG: a 1K texture pack downloads (through its redirect) and unzips", acg.exitCode === 0 && /\d+ files?/.test(acg.stdout), acg.exitCode === 0 ? acg.stdout.trim() : short(acg));

    const kenney = await run(box, `curl -sS -o /dev/null -w '%{http_code}' --max-time 20 https://kenney.nl/`, 60_000);
    check("CONTROL: kenney.nl isn't reachable from the box (it isn't on the list)", kenney.exitCode !== 0, short(kenney));
  } finally {
    await box.kill().catch(() => undefined);
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} OK`);
  if (failed.length > 0) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exit(1);
  },
);
