# mmm-loop

An autonomous, sprint-based agent loop for Claude Code. Point it at a project
with a written vision, run it, and it plans a sprint, specs it, breaks it into
tickets, implements and reviews each ticket, UX-tests what the sprint built
(fixing what's worth fixing in the same sprint), writes an HTML report with a
quiz, and updates its own picture of where the project stands — then halts so
a human can look before the next run.

A deterministic orchestrator (TypeScript on [Bun](https://bun.sh)) drives the
loop; fresh `claude -p` processes do only the creative work inside each step.
Everything checkable programmatically is checked by plain code, never by an
LLM. See [docs/specification.md](docs/specification.md) for the full design.

Inspired by [wsff](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md),
[mattpocock/skills](https://github.com/mattpocock/skills), and
[ralph](https://github.com/snarktank/ralph).

## Install

The loop is a copyable bundle — no package, no global install. Copy it into
the target project (the copy is yours to edit, prompts included):

```bash
cp -r <this-repo>/scripts/mmm-loop <your-project>/scripts/mmm-loop
```

Requirements in the target project: `bun` and `claude` on the PATH, and a git
repository.

## Set up a project

```bash
bun scripts/mmm-loop/loop.ts init
```

This scaffolds (never overwriting existing files):

- `docs/CONTEXT.md` — always-relevant context given to every agent: what the
  project is, tech stack, how to run and test, conventions.
- `docs/vision.md` — what to build. This is the loop's north star; write it
  for an agent deciding what to do next.
- `.working/vision_status.md` — the loop's own picture of where the project
  stands (starts as "nothing is built yet").
- `.working/learnings.md` — append-only one-liners agents leave for each
  other (gotchas, conventions).

Fill in `CONTEXT.md` and `vision.md` by hand — they are the two files the
whole loop feeds on.

## Run

```bash
bun scripts/mmm-loop/loop.ts run
```

One invocation = one full sprint by default. Chain sprints for an overnight
run with:

```bash
bun scripts/mmm-loop/loop.ts run --max-sprints 3
```

A sprint that ends with blocked tickets always halts the run, regardless of
sprints remaining.

### What a sprint does

1. **Validate** — `CONTEXT.md`, `vision.md`, `vision_status.md` exist (else
   exit 1 with a hint to run `init`).
2. **Sprint focus** — pick ONE conservative focus area for the sprint.
3. **Spec** — turn the focus into testable goals.
4. **Tickets** — break the spec into small ordered JSON tickets.
5. **Implement + review** — one ticket at a time: implement, commit
   (`feat(sNN/TTT): ...`), self-report test results, then review exactly that
   ticket's diff. A review may create at most one fix ticket
   (`NNN.1-slug.json`), which runs next.
6. **UX test** (step 5.5) — once all tickets are closed: plan an agentic
   user-experience test of the sprint's delta (existing tools only), execute
   it, and turn findings worth fixing into `NNN-ux-slug.json` tickets that
   run through the normal implement + review loop — in the same sprint. One
   pass per sprint, no re-test after the fixes.
7. **Report** — create/extend `docs/sprint_reports.html`: per-sprint summary,
   diagram, key decisions, blocked-ticket banner, un-ticketized UX findings,
   and a click-to-reveal quiz.
8. **Vision status** — rewrite `.working/vision_status.md` to match reality.

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Requested sprints completed; nothing blocked |
| 1 | Validation failed, or a step failed its postcondition twice |
| 2 | Sprint finished (report + vision status written) but tickets need human intervention |

## The artifact trail

Everything the loop produces is committed to git as it goes:

```
docs/
  sprint_reports.html          # step 6's report (open it in a browser)
.working/                      # the loop's memory — tracked in git
  vision_status.md
  learnings.md
  sprints/
    01-mvp/
      sprint_focus.md
      spec.md
      ux_test_plan.md                # step 5.5's plan
      ux_findings.md                 # step 5.5's findings (stamped when ticketized)
      tickets/
        001-first-thing.json
        001.1-fix-first-thing.json   # review-created fix ticket
        002-second-thing.json
        003-ux-fix-help.json         # UX-finding ticket
```

Ticket filenames are execution order; a fix ticket `NNN.1` sorts directly
after its parent. Each ticket records its own state (`done`, `reviewed`,
`needs_human_intervention`, per-test `passes`) and the commit SHAs that
implemented it.

## When the loop gets stuck (exit 2)

1. Open `docs/sprint_reports.html` — blocked tickets are the banner at the
   top — or grep for `"needs_human_intervention": true` in
   `.working/sprints/*/tickets/`.
2. Edit the ticket JSON directly: set `"needs_human_intervention": false`,
   clear the reason, and write your guidance into `"human_note"`.
3. Run again:

```bash
bun scripts/mmm-loop/loop.ts run
```

The loop resumes exactly at that ticket, and the implement agent's prompt
includes your note.

## Crash safety / resume

There is no state file. On every `run`, the orchestrator derives the current
phase purely from what's on disk (which sprint folders exist, ticket JSON
states, whether the report has this sprint's section, the stamp on
`vision_status.md`). Kill it at any point and rerun — it picks up where it
left off. This is also why `.working/` must stay tracked in git.

If a step's agent fails its programmatic postcondition, it is retried once
with the failure description appended to its prompt; a second failure stops
the run (exit 1) — repeated failure means a human should look.

## Tuning

All knobs live in the copy inside your project:

- **`scripts/mmm-loop/config.ts`** — per-step model, reasoning effort, and
  max turns (defaults: Fable 5 at max effort for planning/implement/review,
  Haiku for the mechanical vision-status rewrite), plus the permission flags
  passed to `claude`. The default is `--dangerously-skip-permissions` —
  that's what autonomous means; swap in `--permission-mode acceptEdits` and
  an allowlist if that's too spicy for a project.
- **`scripts/mmm-loop/prompts/*.md`** — the ten step prompts. Editing them
  per project is normal and expected.

## Developing mmm-loop itself

```bash
bun install
bun test        # 100+ tests: unit + per-step + e2e dry runs with a fake `claude`
bunx tsc --noEmit
```

The e2e tests drive the real CLI against throwaway git projects using
`tests/fixtures/fake-claude.ts` (injected via `MMM_LOOP_CLAUDE_BIN`), which
dispatches canned per-step behaviors from `tests/fixtures/scenarios/`.
