// The error a publish door raises when an A/B experiment is live and the caller didn't say what to do with it (review
// item 13). Zero imports, no `server-only`: the gates, the MCP tools and the tests all name it, and it must not drag the
// experiment store along.

export class AbExperimentRunningError extends Error {
  readonly code = "ab_experiment_running";
  constructor(
    public readonly experimentId: string,
    public readonly experimentName: string,
    public readonly targetPath: string,
    message?: string,
  ) {
    super(
      message ??
        `An A/B test ("${experimentName}") is running on this site, and this would end it. Decide the test first (keep A or promote B), or publish from the Publish dialog and choose "Stop and publish".`,
    );
    this.name = "AbExperimentRunningError";
  }

  /** The body the HTTP routes answer with (the publish dialog reads it). */
  get body(): { error: "ab_experiment_running"; experimentId: string; name: string; targetPath: string } {
    return { error: this.code, experimentId: this.experimentId, name: this.experimentName, targetPath: this.targetPath };
  }
}

/** A system republish that leaves a project alone this time (not an error of the project's: the sweep reports it as skipped):
 *  a decision is being applied on its experiment, or its launch hasn't finished, or its winner isn't in the draft yet. */
export class AbRepublishSkipped extends Error {
  readonly code = "ab_republish_skipped";
  constructor(
    public readonly reason: "decision_in_progress" | "bring_pending",
    message: string,
  ) {
    super(message);
    this.name = "AbRepublishSkipped";
  }
}
