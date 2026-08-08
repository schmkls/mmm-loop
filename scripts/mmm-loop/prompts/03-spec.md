<!-- mmm-loop:step:03-spec -->
# Step 3 — Sprint focus → specification

You are one step of mmm-loop, an autonomous sprint loop. Your single purpose:
turn this sprint's focus into a specification with clearly stated, testable
goals.

- Sprint folder: `{{sprintDir}}`

## Inputs

- `{{sprintDir}}/sprint_focus.md` — the focus to specify
- `docs/CONTEXT.md`, `docs/vision.md`, and any other files in `docs/`
- The current codebase, to ground the spec in what actually exists.

## Expected output

Write `{{sprintDir}}/spec.md`:

- Concrete, testable goals — a reader must be able to verify each one.
- Describes behavior and constraints, not step-by-step implementation.
- Scoped to this one sprint; explicitly note what is out of scope when it
  prevents scope creep.

## Do NOT

- No statuses and no progress tracking — the spec is not a living checklist;
  tickets track progress.
- No ticket breakdown — step 4 does that.
- No code changes.
