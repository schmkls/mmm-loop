# mmm-loop

An orchestrator that drives a project forward in sprints by running a fixed
sequence of steps, each executed by a fresh Claude Code agent, and checking
programmatically that each step produced what was asked for.

## Language

**Step**:
One unit of agent work in a sprint — fill a prompt, run one agent, judge the
result, commit. Identified by its spec section number (`04-tickets`, `05.5-ux-test`).
_Avoid_: stage, phase (a Phase is the *derived* answer to "which step runs next").

**Postcondition**:
The rule that decides whether a step's output is acceptable. It either passes,
or produces the text the agent is given back on its one retry.
_Avoid_: check, validation, assertion, guard.

**Observation**:
The before/after data a postcondition judges. Fresh agent output — untrusted by
definition, where a malformed or missing artifact is an expected outcome to be
reported, never a fault.
_Avoid_: snapshot, state, result.

**Snapshot**:
The project state phase derivation reads in order to choose the next step. Loop
artifacts the orchestrator itself wrote and maintains — trusted, where a
malformed or missing artifact is a fault in the loop, not an outcome.

**Loop artifact**:
A file the loop owns and commits — sprint folders, `sprint_focus.md`, `spec.md`,
tickets, `ux_findings.md`, `sprint_reports.html`, `vision_status.md`.

**Fix ticket**:
A ticket created by a review of another ticket, numbered `NNN.1`. At most one
per reviewed ticket, and a review of a fix ticket may never create another.

**Cleanup sprint**:
A sprint whose folder is exactly `NN-cleanup`, which improves the codebase
instead of adding features. It has no sprint focus; its spec's candidates
stamp is the whole plan.

**Feedback sprint**:
A sprint whose folder is exactly `NN-feedback`, planned from the human
feedback waiting in `docs/feedback/inbox/` instead of from the vision. Its
sprint focus carries the feedback stamp and one disposition per item.
_Avoid_: feedback loop (the whole product is a loop), triage sprint.

**Feedback item**:
One non-empty `*.md` file directly in `docs/feedback/inbox/`. Human input,
never written by the loop — the loop only archives it to
`docs/feedback/handled/NN-<name>.md` once triaged.
