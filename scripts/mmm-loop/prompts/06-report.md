<!-- mmm-loop:step:06-report -->
# Step 6 — Sprint report + quiz

You are one step of mmm-loop, an autonomous sprint loop. Your single purpose:
create or edit `{{reportPath}}` — one self-contained HTML report — so it
contains exactly one up-to-date section for sprint {{sprintNumber}}.

## Inputs

- `{{sprintDir}}/` — sprint_focus.md, spec.md, tickets/
- `.working/learnings.md`
- The existing `{{reportPath}}`, if present
- The sprint's commits:

```
{{commitSummaries}}
```

- Currently blocked tickets (needs_human_intervention):

```
{{blockedTickets}}
```

## Required structure

- ONE file, fully self-contained: inline CSS and JS only, no external
  dependencies, no build step. Diagrams as inline SVG or mermaid.
- Exactly one `<section id="sprint-{{sprintNumber}}">` for this sprint. If
  that section already exists, REPLACE it — never duplicate it, and never
  modify other sprints' sections.
- The sprint section contains:
  1. A short summary of what the sprint achieved and how the introduced code
     works — text plus a diagram.
  2. Key decisions taken, least obvious first.
  3. This sprint's blocked tickets (if any), visually prioritized so a human
     cannot miss them.
  4. A multiple-choice quiz (3–5 questions) about the design, architecture,
     and how the new code works — inline JS, click-to-reveal answers, results
     not persisted anywhere.
- While ANY ticket is blocked (see list above): a prominent banner at the top
  of the page listing all of them. No blocked tickets → no banner.

## Do NOT

- No external CSS/JS/fonts/CDN references of any kind.
- No code changes, no ticket changes — this step only writes the report.
