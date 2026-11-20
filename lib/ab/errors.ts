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

/** A publish FROM THE DRAFT of a project whose promoted Variant B isn't in the draft yet (it clashed, or waits for Len): it would
 *  send the page without B and undo the promotion. Raised by the bottom door, so every door meets it — the web route, the MCP
 *  tool, Len's card — and each says how to resolve it. */
export class AbBringPendingError extends Error {
  readonly code = "ab_bring_pending";
  constructor(
    public readonly experimentId: string,
    public readonly experimentName: string,
    public readonly bringState: "pending" | "conflict" | "bringing",
    message?: string,
  ) {
    super(
      message ??
        `The winner of the A/B test "${experimentName}" is live but isn't in the draft yet, so publishing the draft would undo it. In OpenLen, open the A/B card (or the Publish dialog) and choose "Bring into draft" — or "Discard Variant B's changes" to give them up — then publish.`,
    );
    this.name = "AbBringPendingError";
  }

  /** The body the HTTP routes answer with (the publish dialog reads it). */
  get body(): { error: "ab_bring_pending"; experimentId: string; name: string; bringState: string } {
    return { error: this.code, experimentId: this.experimentId, name: this.experimentName, bringState: this.bringState };
  }
}
