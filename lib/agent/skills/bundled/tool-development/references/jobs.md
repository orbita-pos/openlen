# Jobs: heavy work in OpenLen's box

A job is a script of this tool that runs in OpenLen's box (the same machine as your terminal) when the person asks for it: exporting a video, a large PDF from files they upload, anything that needs Python or minutes of work. The tool asks for it with `window.openlen.jobs.run(...)`; OpenLen shows the person what it is and the most it can cost, and nothing runs until they press its button. It is charged to the person per second the box runs (about 0.28 credits a minute), never more than its minutes plus 2 minutes for installing — the most the confirmation shows.

Use a job only for that kind of work. A quick operation belongs in the tool itself or its own backend (`data.md`), and a report made from visitors' data is made in the tool (below).

## Declare it

In /package.json, under `openlen.tool.jobs`, one entry per job:

```json
{
  "openlen": {
    "tool": {
      "placement": "rail",
      "jobs": {
        "export-video": { "script": "./jobs/export-video.mjs", "maxMinutes": 10 }
      }
    }
  }
}
```

- The name: lowercase letters, digits and hyphens, starting with a letter, at most 40 characters. At most 8 jobs.
- `script`: a file in /jobs, `.mjs` (Node) or `.py` (Python 3).
- `maxMinutes`: from 1 to 30; 10 if you leave it out. Past it, the job is stopped.
- Its title, in every locale file, under `jobs` — the person reads it in OpenLen's confirmation:

```json
{ "meta": { "title": "…", "description": "…" }, "jobs": { "export-video": "Export the video" } }
```

Installing refuses a job that is badly declared, has no script or no title.

## What the script gets

It runs as its own user, in a copy of this version's /jobs (its working directory is the copy's root, so the script is `jobs/<file>`), with these variables:

| Variable | What it is |
|---|---|
| `OPENLEN_JOB_DIR` | The job's own folder. Write `result.json` here. |
| `OPENLEN_JOB_INPUT` | A JSON file with the `input` the tool passed (at most 16 KB). |
| `OPENLEN_JOB_FILES` | A folder with the files the person picked, by their names. |
| `OPENLEN_JOB_OUT` | A folder for the files to hand the person: at most 4, 20 MB each. |
| `OPENLEN_JOB_PROGRESS` | Append a line to show progress; the tool and OpenLen show the last one. |

- `$OPENLEN_JOB_DIR/result.json`: JSON of at most 64 KB; the tool reads it as `job.result`.
- Exit code 0 is `completed`. Anything else is `failed`, and `job.detail` carries the end of its stderr.
- Dependencies go in /jobs, never in /package.json (that one is the browser app's): for Node, /jobs/package.json `dependencies` (installed with `npm install`, or `npm ci` if there is a /jobs/package-lock.json); for Python, /jobs/requirements.txt. Installing counts against the 2 minutes of allowance.
- The box's network reaches package registries, GitHub and the pages' CDNs — not the tool's backend, not OpenLen.
- The job runs as its own user: it can't write in this project or read anyone's files in the box, and everything it leaves outside `out/` and `result.json` is removed when it ends.

```js
// jobs/export-video.mjs
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const input = JSON.parse(readFileSync(env.OPENLEN_JOB_INPUT, "utf8"));
const progress = (line) => appendFileSync(env.OPENLEN_JOB_PROGRESS, `${line}\n`);

const videos = readdirSync(env.OPENLEN_JOB_FILES);
progress(`0 / ${videos.length}`);
// … the work, writing what the person gets into env.OPENLEN_JOB_OUT …
writeFileSync(join(env.OPENLEN_JOB_DIR, "result.json"), JSON.stringify({ videos: videos.length, quality: input.quality }));
```

```python
# jobs/report.py  (its packages in jobs/requirements.txt)
import json, os
env = os.environ
data = json.load(open(env["OPENLEN_JOB_INPUT"]))
with open(env["OPENLEN_JOB_PROGRESS"], "a") as p:
    p.write("starting\n")
# … write the files into env["OPENLEN_JOB_OUT"] …
json.dump({"ok": True}, open(os.path.join(env["OPENLEN_JOB_DIR"], "result.json"), "w"))
```

## From the tool

```tsx
const picked = await window.openlen.files.pick({ accept: "video/*", multiple: true });
if (!picked) return; // the person closed OpenLen's picker
const run = await window.openlen.jobs.run("export-video", { input: { quality: "high" }, files: picked });
if (run.status === "declined") return; // they said no in OpenLen's confirmation
if (run.status === "refused") return showWhy(run.reason);
const done = await window.openlen.jobs.follow(run.job.id, (job) => setProgress(job.progress));
// done.status: "completed" | "killed" | "failed"; done.delivered: [{ name, url, size }]; done.result
```

- `files.pick({ accept?, multiple? })` opens OpenLen's own file picker — the tool never reads the person's disk. It returns `[{ id, name, size, contentType }]`, or `null`. Those files are the only ones a job can get.
- `jobs.run(name, { input?, files? })` returns `started` at once with the job; it doesn't wait for the end. `refused` reasons: `unknown_job`, `bad_input`, `bad_upload`, `plan_required`, `no_credits`, `sandbox_off`, `budget` (OpenLen's daily limit), `busy` (another job or your own terminal has the box), `eyes_never_run`.
- `jobs.get(id)`, `jobs.list()` (the person's jobs of this tool, newest first), `jobs.cancel(id)`, `jobs.follow(id, onUpdate)`.
- OpenLen shows every running job under the tool with a stop button, even if the tool shows nothing. A restart of OpenLen stops it as `failed` with detail `stopped_by_restart`: say so and offer to run it again.

## Never pass visitors' data to a job

A job never gets form submissions, app rows or anything copied from them — not from `forms()`, not from `query()`, not from the tool's backend. A report with that data (today's bookings as a PDF or a CSV) is made in the tool itself, in the browser, with a library from the catalog or npm, and handed to the person with:

```ts
const { url } = await window.openlen.files.deliver({ name: "bookings.pdf", contentType: "application/pdf", bytes });
```

## Test it before installing

Run the script yourself in your terminal, with the variables pointing to a folder of your own:

```bash
mkdir -p /tmp/job/out /tmp/job/files && echo '{"quality":"high"}' > /tmp/job/input.json
OPENLEN_JOB_DIR=/tmp/job OPENLEN_JOB_INPUT=/tmp/job/input.json OPENLEN_JOB_OUT=/tmp/job/out \
OPENLEN_JOB_PROGRESS=/tmp/job/progress OPENLEN_JOB_FILES=/tmp/job/files node jobs/export-video.mjs
```

Then check `out/`, `result.json` and the progress file. Your eyes (`view_page`, `use_page`) never run a job: `jobs.run` answers `eyes_never_run` there. A real run is the person's — in this project's canvas or once installed, after they confirm what it costs.
