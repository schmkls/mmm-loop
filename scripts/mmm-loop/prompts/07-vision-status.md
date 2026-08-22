<!-- mmm-loop:step:07-vision-status -->
# Step 7 — Update vision status

You are one step of mmm-loop, an autonomous sprint loop. Your single purpose:
rewrite `{{visionStatusPath}}` so it reflects reality after sprint
{{sprintNumber}}. Replace the whole file — never append to it.

This file is what the next sprint's planning reads first; drift here
compounds into bad sprints. Be factual and current.

## Inputs

- The previous `{{visionStatusPath}}`
- `{{sprintDir}}/` — what the sprint set out to do (sprint_focus.md, spec.md)
  and what actually happened (tickets/)
- `docs/vision.md`

## Expected output

Overwrite `{{visionStatusPath}}` with exactly this structure:

    _Last updated: sprint {{sprintNumber}}_

    # Vision status

    ## What exists now
    ...

    ## What works (verified)
    ...

    ## Known gaps
    ...

    ## Blocked on human
    ...

Rules:

- The first line must be exactly `_Last updated: sprint {{sprintNumber}}_`.
- All four `##` headings must be present, in that order.
- Keep the file under ~120 lines.
- Only claim something "works" if the sprint's tickets verified it
  (`tests[].passes: true`); everything else is a gap.
- Unresolved UX findings (not ticketized, or ticketized but blocked) belong
  under "Known gaps".
- Cleanup sprints (folder `NN-cleanup`, no sprint_focus.md) do not advance
  the vision — the content usually carries over, but the stamp must still be
  updated.
- A vision change proposed by any feedback sprint (folder `NN-feedback`,
  `## Vision proposals` in its `sprint_focus.md`) belongs under "Blocked on
  human" — verbatim, and **carried over every sprint**, feedback sprint or
  not, until `docs/vision.md` reflects it or the human drops the entry. Only
  a human can edit the vision, so this is the loop's only way to keep asking.
- Feedback items a triage marked `In this sprint: deferred` belong under
  "Known gaps": they were archived as handled, so this file is the only
  place they survive.
- "Blocked on human" lists tickets with `needs_human_intervention: true` and
  their reasons — or "Nothing.".

## Do NOT

- Do not append — replace the file's content entirely.
- Do not modify anything else in the project.
