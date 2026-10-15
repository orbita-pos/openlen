// The same steps on the real git and on ours, side by side.
import { OurRepo } from "./our-git";
import { RealRepo, type GitOutput } from "./real-git";

export class Pair {
  readonly real = new RealRepo();
  readonly ours = new OurRepo();

  /** Both repositories start like OpenLen's: the files, and an "Initial commit" with all of them. */
  async start(files: Readonly<Record<string, string>>): Promise<void> {
    this.real.write(files);
    this.real.git(["add", "-A"]);
    this.real.git(["commit", "-q", "--allow-empty", "-m", "Initial commit"]);
    this.ours.write(files);
    await this.ours.git(["status"]);
  }

  write(files: Readonly<Record<string, string | null>>): void {
    this.real.write(files);
    this.ours.write(files);
  }

  tick(seconds = 60): void {
    this.real.timestamp += seconds;
    this.ours.timestamp += seconds;
  }

  async both(args: readonly string[], o: { readonly cwd?: string } = {}): Promise<{ real: GitOutput; ours: GitOutput }> {
    const real = this.real.git(args, o);
    const r = await this.ours.git(args, o);
    return { real, ours: { stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode } };
  }

  async heads(): Promise<{ real: string; ours: string }> {
    return { real: this.real.git(["rev-parse", "HEAD"]).stdout.trim(), ours: (await this.ours.store.readRepo())!.head };
  }

  /** Both working trees, as repository paths. */
  snapshots(): { real: Record<string, string>; ours: Record<string, string> } {
    return { real: this.real.snapshot(), ours: Object.fromEntries(Object.entries(this.ours.files).map(([p, c]) => [p.slice(1), c])) };
  }

  dispose(): void {
    this.real.dispose();
  }
}
