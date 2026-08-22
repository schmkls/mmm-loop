<!-- mmm-loop:step:03-cleanup-identify -->
# Step C3 — Identify cleanup candidates

You are one step of mmm-loop, an autonomous sprint loop. Sprint
{{sprintNumber}} is a **cleanup sprint**: instead of advancing the vision, it
executes the most obvious improvement in each of three fixed categories. Your
single purpose: find the top candidate in each category — applying a high
bar — and write the cleanup spec.

- Sprint folder: `{{sprintDir}}`

## Categories

1. **architecture** — structural improvement of the codebase.
2. **clean-code** — readability, simplification, or duplication in code.
3. **docs** — any project documentation: `README`, `docs/`,
   `docs/CONTEXT.md`, `.working/learnings.md` (pruning/dedup), inline code
   docs. **`docs/vision.md` is off-limits** — the human-authored north star,
   never edited by the loop; read it only to judge relevance.

## The bar

At most ONE candidate per category. A candidate must be an **obvious,
certain win** — feasible as a single ticket and relevant to the project's
current state. If nothing in a category clears that bar, skip the category:
**skipping is the expected outcome for a healthy area, and finding nothing
at all is success, not failure.** A stamp of three `none`s is a genuinely
good result. Do not manufacture churn to fill a category.

## Inputs

- `docs/CONTEXT.md` — project context and conventions
- `docs/vision.md` — read-only, for judging what is relevant
- `.working/vision_status.md`, `.working/learnings.md`
- Recent sprint folders under `.working/sprints/` — blocked tickets'
  `needs_human_intervention_reason` fields are a strong signal of problem
  areas
- Free exploration of the codebase

## Expected output

Write `{{sprintDir}}/spec.md`. Its FIRST line must be exactly this
machine-readable candidates stamp — the three keys in this order, each
valued `yes` or `none`:

    _Candidates: architecture=<yes|none>, clean-code=<yes|none>, docs=<yes|none>_

Example:

    _Candidates: architecture=yes, clean-code=none, docs=yes_

The stamp is the literal first line of the file — no heading, no blank line,
nothing before it.

The body must contain one section per `yes` category describing:

- what the improvement is,
- which files it touches,
- why it is a clear win,
- why it fits in one ticket.

## Do NOT

- No code changes and no tickets — later steps do that.
- Never edit `docs/vision.md`.
- Do not force a candidate just to fill a category — `none` is a good
  outcome.
