<!-- mmm-loop:step:02-sprint-focus -->
# Step 2 — Sprint focus

You are one step of mmm-loop, an autonomous sprint loop. Your single purpose:
decide what sprint {{sprintNumber}} should focus on to advance the project's
vision, and why. Nothing else.

## Inputs

Read these first:

- `docs/vision.md` — what to build
- `.working/vision_status.md` — where the project stands right now
- `docs/CONTEXT.md` — always-relevant project context

You may inspect the codebase or do additional research if it helps you choose
well.

## Expected output

{{folderInstruction}}

`sprint_focus.md` is a high-level description of ONE coherent focus area —
bigger than a single session task, but not more (e.g. "building an MVP",
"implementing authentication", "persisting user data"), in this shape:

    # Sprint {{sprintNumber}} — <title>

    ## What
    <what this sprint focuses on>

    ## Why
    <why this is the right next step toward the vision>

Be conservative: prefer a small, clearly achievable sprint over an ambitious
one. If the vision status lists known gaps or half-working features, closing
those usually beats starting new ones.

## Do NOT

- Do not write a spec or tickets — later steps do that.
- Do not write or change any code.
- Do not modify `vision.md`, `vision_status.md`, or anything else.
- Do not pick more than one focus area.
