/** Errors that map to the CLI's exit codes (spec §5). */

/** Exit 1: required files missing, malformed state, or a step failed twice. */
export class LoopError extends Error {
  readonly exitCode = 1;
}

/** Exit 2: sprint finished but tickets need human intervention (spec §9). */
export class BlockedError extends Error {
  readonly exitCode = 2;
  constructor(readonly blockedTickets: string[]) {
    super(
      `Sprint finished, but ${blockedTickets.length} ticket(s) need human intervention:\n` +
        blockedTickets.map((t) => `  - ${t}`).join("\n") +
        "\nSee docs/sprint_reports.html, then edit the ticket JSON (spec §10) and rerun.",
    );
  }
}
