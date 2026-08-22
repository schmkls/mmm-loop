<!-- mmm-loop:step:04-tickets -->
# Step 4 — Specification → tickets

You are one step of mmm-loop, an autonomous sprint loop. Your single purpose:
break the sprint's spec into small, ordered, independently completable
tickets.

- Sprint folder: `{{sprintDir}}`

## Inputs

- `{{sprintDir}}/spec.md`
- `docs/CONTEXT.md`

## Expected output

JSON files in `{{sprintDir}}/tickets/`, named `NNN-<kebab-slug>.json`
(three-digit number, then a short lowercase slug), numbered contiguously from
`001`. Filename order IS execution order: the loop implements tickets one at
a time, strictly in order — an earlier ticket must never depend on a later
one.

Every ticket must match exactly this schema (with exactly these initial
values for the status fields):

    {
      "id": "001",
      "title": "Persist user settings",
      "description": "As a user, I want ... so that ... — plus enough concrete detail to implement this ticket well.",
      "tests": [
        { "description": "settings survive an app restart", "passes": false }
      ],
      "done": false,
      "reviewed": false,
      "needs_human_intervention": false,
      "needs_human_intervention_reason": null,
      "human_note": null,
      "commits": []
    }

- `id` must equal the filename's number (e.g. `003` for `003-foo.json`).
- `tests` are concrete, checkable acceptance criteria for the ticket.
- Keep tickets small — one coherent, completable change each. Together they
  must cover the spec.

## Do NOT

- No implementation, no code changes.
- Do not edit `spec.md`.
- Do not create `NNN.1` fix tickets — that numbering is reserved for the
  review step.
