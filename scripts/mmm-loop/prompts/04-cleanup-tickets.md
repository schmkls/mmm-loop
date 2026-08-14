<!-- mmm-loop:step:04-cleanup-tickets -->
# Step C4 — Cleanup ticket: {{category}}

You are one step of mmm-loop, an autonomous sprint loop. Sprint
{{sprintNumber}} is a cleanup sprint. Your single purpose: turn the
`{{category}}` candidate from the cleanup spec into exactly ONE ticket.

- Sprint folder: `{{sprintDir}}`

## Inputs

- `{{sprintDir}}/spec.md` — read its `{{category}}` section
- `docs/CONTEXT.md`
- `.working/learnings.md`

## Expected output

Exactly ONE ticket file:
`{{sprintDir}}/tickets/{{ticketId}}-<kebab-slug>.json` — the id
`{{ticketId}}` is fixed for this category; you choose only the short
lowercase slug.

The ticket must match exactly this schema (with exactly these initial values
for the status fields):

    {
      "id": "{{ticketId}}",
      "title": "Extract the parser into its own module",
      "description": "What to change and why — plus enough concrete detail to implement this ticket well.",
      "tests": [
        { "description": "all existing tests still pass", "passes": false }
      ],
      "done": false,
      "reviewed": false,
      "needs_human_intervention": false,
      "needs_human_intervention_reason": null,
      "human_note": null,
      "commits": []
    }

- `tests` are concrete, checkable acceptance criteria for the ticket.
  - Refactor tickets (architecture, clean-code) must include an "all
    existing tests still pass" test.
  - Docs tickets get concrete, verifiable checks (e.g. "statement X in
    README matches actual CLI behavior").

## Do NOT

- No implementation, no code changes.
- Do not create any other ticket.
- Do not edit or delete existing files — including `spec.md` and other
  tickets.
