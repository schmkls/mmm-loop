/** Errors that map to the CLI's exit codes (spec §5). */

/** Exit 1: required files missing, malformed state, or a step failed twice. */
export class LoopError extends Error {
  readonly exitCode = 1;
}

/** Exit 2: sprint finished but tickets need human intervention (spec §9).
 * The sprint's branch stays checked out, nothing is merged (spec §6.4). */
export class BlockedError extends Error {
  readonly exitCode = 2;
  constructor(
    readonly blockedTickets: string[],
    sprintBranch: string,
  ) {
    super(
      `Sprint finished, but ${blockedTickets.length} ticket(s) need human intervention:\n` +
        blockedTickets.map((t) => `  - ${t}`).join("\n") +
        `\nSee docs/sprint_reports.html (on ${sprintBranch}, left checked out). Two options (spec §10):\n` +
        `  - unblock: edit the ticket JSON and rerun — the loop finishes the sprint, then merges ${sprintBranch}\n` +
        `  - abandon: merge or delete ${sprintBranch} manually`,
    );
  }
}
