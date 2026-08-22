# mmm-loop

An autonomous, sprint-based agent loop for Claude Code. Point it at a project
with a written vision and run it: each run plans one sprint, implements and
reviews it ticket by ticket, UX-tests what it built, writes an HTML report,
and updates its own picture of where the project stands — then halts so a
human can look before the next run. Whenever `docs/feedback/inbox/` is not
empty, the next sprint is planned from the notes in it instead of from the
vision.

A deterministic orchestrator (TypeScript on [Bun](https://bun.sh)) drives the
loop; fresh `claude -p` processes do only the creative work inside each step.
[How the loop works](#how-the-loop-works) below has the details;
[docs/specification.md](docs/specification.md) is the full design.

Inspired by [wsff](https://github.com/humanlayer/advanced-context-engineering-for-coding-agents/blob/main/wsff.md),
[mattpocock/skills](https://github.com/mattpocock/skills), and
[ralph](https://github.com/snarktank/ralph).

## Quick start

Requirements in the target project: `bun` and `claude` on the PATH, and a git
repository with at least one commit on `main` (or whatever `BASE_BRANCH`
names) checked out.

```bash
# 1. Copy the bundle in — no package, no global install; the copy is yours to edit
cp -r <this-repo>/scripts/mmm-loop <your-project>/scripts/mmm-loop
cd <your-project>

# 2. Scaffold the files the loop needs (never overwrites existing files)
bun scripts/mmm-loop/loop.ts init

# 3. Fill in docs/CONTEXT.md and docs/vision.md by hand

# 4. Run one sprint
bun scripts/mmm-loop/loop.ts run
```

`init` scaffolds four files, plus an optional feedback drop-box
(`docs/feedback/` with a README and the two folders below):

- `docs/CONTEXT.md` — always-relevant context given to every agent: what the
  project is, tech stack, how to run and test, conventions.
- `docs/vision.md` — what to build; the loop's north star. Write it for an
  agent deciding what to do next.
- `.working/vision_status.md` — the loop's own picture of where the project
  stands (starts as "nothing is built yet").
- `.working/learnings.md` — append-only one-liners agents leave for each
  other (gotchas, conventions).
- `docs/feedback/inbox/` and `docs/feedback/handled/` — where you drop
  feedback for the loop, and where it archives what it has handled. Optional:
  delete them and nothing breaks. See [Feedback sprints](#feedback-sprints).

`CONTEXT.md` and `vision.md` are the two files the whole loop feeds on — fill
them in before the first run.

Heads-up: agents run with `--dangerously-skip-permissions` by default —
that's what autonomous means. See [Tuning](#tuning) to change it.

## Running

One invocation = one full sprint by default. Chain sprints for an overnight
run:

```bash
bun scripts/mmm-loop/loop.ts run --max-sprints 3
```

A sprint that ends with blocked tickets always halts the run, regardless of
sprints remaining.

Every third sprint (the cadence is configurable, `0` disables it) runs as a
**cleanup sprint** instead of a feature sprint — see
[Cleanup sprints](#cleanup-sprints). Force one with:

```bash
bun scripts/mmm-loop/loop.ts run --cleanup
```

(`--cleanup` applies to the first sprint the run *creates*; if the run
creates no cleanup sprint, it has no effect and says so.)

Before it creates a sprint, the loop checks `docs/feedback/inbox/`. If the
folder is not empty, that sprint is a **feedback sprint** instead — this
outranks both cleanup triggers. The trigger is the folder being non-empty,
not the files being new; the loop empties the inbox itself as it handles
each item. See [Feedback sprints](#feedback-sprints).

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Requested sprints completed; nothing blocked |
| 1 | Validation failed (missing files, wrong Claude account), a step failed its postcondition twice, or a sprint-branch problem (wrong branch at startup, merge conflict) |
| 2 | Sprint finished (report + vision status written) but tickets need human intervention |

## What a sprint leaves behind

Everything the loop produces is committed to git as it goes:

```
docs/
  sprint_reports.html          # step 6's report (open it in a browser)
  feedback/
    inbox/                     # you drop feedback here
    handled/
      02-slow-cli.md           # archived by the sprint that handled it
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

`docs/sprint_reports.html` is the human-facing summary: per-sprint overview,
diagram, key decisions, a banner for blocked tickets, UX findings that were
not fixed, and a click-to-reveal quiz about the introduced code.

Each sprint runs on its own `sprint/NN` git branch (created and merged by
the orchestrator, never by an agent). A sprint that completes clean is
merged back into `main` (the configured `BASE_BRANCH`) with a `--no-ff`
merge commit and its branch is
deleted — one merge commit per sprint, so the history reads sprint by
sprint:

```
$ git log --graph --oneline main
*   f3a21c9 chore(loop): merge sprint 02
|\
| * 9d0e1f2 chore(loop): sprint 02 vision status
| * ...
|/
*   a1b2c3d chore(loop): merge sprint 01
|\
| * ...
```

## When the loop gets stuck (exit 2)

A blocked sprint's `sprint/NN` branch is left checked out and unmerged —
`main` has none of the sprint's work, and `git diff main..sprint/NN` is the
whole sprint, reviewable in one sitting.

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
includes your note. When the sprint then finishes clean, it is merged into
`main` as usual. To abandon a blocked sprint instead, merge or delete its
branch yourself — rerunning without doing either just exits 2 again.

## How the loop works

All control flow is plain code: the orchestrator validates files, derives the
current phase from disk, picks tickets, records commits, and applies stop
conditions. LLM agents — one fresh `claude -p` process per step, each given a
purpose-built prompt and only the files that step needs — do only the
creative work. After every agent run the orchestrator checks a programmatic
**postcondition** (file exists, stamp parses, ticket JSON validates). A
failed check gets one retry with the failure description appended to the
prompt; a second failure stops the run (exit 1). Nothing checkable by code is
ever delegated to an LLM.

There is no state machine to advance and no state file to keep in sync. Each
turn of the loop asks the filesystem one question — *what is the next missing
artifact?* — runs the single agent that produces it, and asks again:

```
run:
    step 1 — validate: required files, the logged-in Claude account, and the
             git branch preflight; any problem exits 1 before anything spawns

    repeat forever:
        step = nextStep(what is on disk)

        if step == "plan a new sprint":        # the previous one is finished
            merge sprint/NN into the base branch
              ...unless it has blocked tickets → exit 2, branch left unmerged
            if --max-sprints is used up        → exit 0
            create the next sprint/NN branch, plus the folder that marks
            its type: NN-feedback if docs/feedback/inbox/ holds an item —
            that outranks cleanup and leaves a pending --cleanup pending —
            else NN-cleanup on --cleanup or every CLEANUP_CADENCE-th sprint

        spawn step's agent → check its postcondition → commit what it wrote
        # postcondition fails: one retry with the failure appended, then exit 1
        # usage limit hit:     sleep until reset, re-run, no retry consumed
```

`nextStep` is a pure function of the files on disk. It reads top to bottom and
returns at the first thing that is missing:

```
nextStep:
    sprint = the highest-numbered folder in .working/sprints/

    # planning — the sprint's type decides which steps come first
    feature sprint:   no sprint_focus.md → 2 | no spec.md → 3 | no tickets → 4
    feedback sprint:  focus missing, or not stamped triaged=yes  → F2
                      then actionable=none → the tail below, with no tickets
                      otherwise           → 3 and 4, exactly as a feature sprint
    cleanup sprint:   no spec.md → C3 | a "yes" category with no ticket yet → C4

    # ticket loop — walk tickets in filename order, first actionable one wins
    for each ticket:
        done but not reviewed  → 5.2 review
        not done               → 5.1 implement
    # a review's fix ticket NNN.1 sorts right after its parent, so the next
    # pass simply picks it up; blocked tickets count as closed and are skipped

    # all tickets closed:
    if the report has no <section id="sprint-NN">:   # ⇒ UX pass not done yet
        no ux_test_plan.md            → 5.5.1
        no ux_findings.md             → 5.5.2
        findings stamped "not yet ticketized" → 5.5.3
              ↳ any tickets it writes drop the walk back to 5.1
        otherwise                     → 6 report
    if vision_status.md isn't stamped with this sprint number → 7
    otherwise                                                 → plan a new sprint
```

Two consequences worth naming. Reviewing an earlier ticket outranks
implementing a later one, so a fix ticket lands before the sprint moves on.
And the report section doubles as the UX pass's "done" marker — once it
exists, no later pass can re-enter 5.5, which is what bounds the pass to once
per sprint even when its tickets send the loop back to implement.

### The steps

| Step | Prompt | What the agent does | Writes |
|---|---|---|---|
| 1 validate | — (plain code) | checks `CONTEXT.md`, `vision.md`, `vision_status.md` exist, that the logged-in Claude account is the allowed one, and runs the sprint-branch preflight; else exit 1 | — |
| 2 sprint focus | `02-sprint-focus` | picks ONE conservative focus area for the sprint, and why | `sprint_focus.md` |
| 3 spec | `03-spec` | turns the focus into testable goals (no statuses — that's the tickets' job) | `spec.md` |
| 4 tickets | `04-tickets` | breaks the spec into small, ordered, independently completable tickets | `tickets/NNN-slug.json` |
| 5.1 implement | `05-implement` | implements the first open ticket, commits code, runs the ticket's tests, self-reports `passes`, flips `done` (or blocks itself with a reason) | code commits, ticket JSON |
| 5.2 review | `05-review` | reviews exactly the diff of the ticket's recorded commits; findings worth fixing become at most one fix ticket | `tickets/NNN.1-slug.json` (optional) |
| 5.5.1 UX plan | `05.5-ux-plan` | decides how (and whether) the sprint's user-facing delta can be tested agentically — existing tools only, no new dependencies | `ux_test_plan.md` |
| 5.5.2 UX test | `05.5-ux-test` | executes the plan the way a user would (CLI, API, docs count too); "No findings." is a valid outcome | `ux_findings.md` |
| 5.5.3 UX ticketize | `05.5-ux-tickets` | turns findings worth fixing into normal tickets that run in the same sprint | `tickets/NNN-ux-slug.json` (zero or more) |
| 6 report | `06-report` | creates/extends the report: summary, diagram, key decisions, blocked banner, unfixed UX findings, quiz | `docs/sprint_reports.html` |
| 7 vision status | `07-vision-status` | rewrites the status file to match reality — fixed template, replaced each sprint, ~120 lines max | `.working/vision_status.md` |
| F2 feedback triage | `02-feedback-focus` | feedback variant of 2: gives every inbox item one disposition — already in the vision, needs a vision change (a proposal, never an edit), or declined — and writes the sprint focus from that | `sprint_focus.md` with a feedback stamp |
| C3 identify | `03-cleanup-identify` | cleanup variant of 2–3: at most one obvious-win candidate per category (architecture, clean-code, docs) | `spec.md` with a candidates stamp |
| C4 ticketize | `04-cleanup-tickets` | cleanup variant of 4: one agent run per `yes` category, one ticket each with fixed IDs `001`–`003` | `tickets/00N-slug.json` |

Git is part of the design: the orchestrator commits every artifact
deterministically (`chore(loop): sprint NN spec`, `... tickets`, `... ux
findings`, ...), and the implement agent commits code as `feat(sNN/TTT): ...`
(`fix` for fix tickets, `refactor`/`docs` for cleanup tickets) so commits and
tickets stay greppable both ways. After each implement run the orchestrator
records the run's new commit SHAs into the ticket's `commits` array — the
review step diffs exactly those commits, not "the last commit".

### Staying in the smart zone

Agent loops degrade when context balloons and tasks blur together. The loop
keeps every invocation small and sharply scoped:

- **Fresh process, minimal context.** No conversation carries over between
  steps. Each prompt states the agent's single purpose, its inputs, its exact
  expected output, and what not to do.
- **Small units of work.** The sprint-focus prompt is deliberately
  conservative (one coherent focus area, not more); tickets are small and
  ordered; the implement loop takes exactly one ticket at a time.
- **Hard bounds against spinning.** One retry per step, then die. At most one
  fix ticket per reviewed ticket; reviews of fix tickets never create
  tickets. One UX pass per sprint, no re-test after UX fixes land.
- **Code judges, not LLMs.** Postconditions, phase selection, ticket
  ordering, and stop conditions are all plain code — there is no "is the
  vision done?" LLM gate anywhere in the control path.
- **Deliberately tiny shared memory.** Agents pass notes through
  `.working/learnings.md` one-liners, and `vision_status.md` is rewritten
  (not appended) each sprint against a fixed template.

### Cleanup sprints

Every `CLEANUP_CADENCE`-th created sprint (default 3 → sprints 03, 06, 09,
...) — or any sprint forced with `--cleanup` — swaps steps 2–4 for C3/C4 and
keeps everything else. The folder is exactly `NN-cleanup` (a reserved slug,
created by the orchestrator before any agent runs) and there is no
`sprint_focus.md` — the folder name is the focus.

C3 explores the codebase and writes a `spec.md` whose first line is a
machine-readable stamp (`_Candidates: architecture=yes, clean-code=none,
docs=yes_`); C4 then runs once per `yes` category — architecture (`001`)
first, docs (`003`) last, so the docs ticket documents the post-cleanup
state. The bar is deliberately high: a candidate must be an obvious, certain,
single-ticket win. **Finding nothing is a valid, successful outcome** — the
empty sprint still runs its UX pass (doubling as a regression check, since
cleanup must not change behavior) and reports that nothing needed cleaning.
`docs/vision.md` is human-authored and never touched by the loop.

### Feedback sprints

Feedback is a file drop. Write what you think — one markdown file per point
— into `docs/feedback/inbox/`:

```bash
echo "The CLI takes 20 seconds to print help. That is absurd." \
  > docs/feedback/inbox/slow-cli.md
```

Before it creates each sprint, the loop lists the inbox. An **item** is a
`.md` file that is not a dotfile and has something other than whitespace in
it — so a `.gitkeep`, an empty file, or a stray `notes.txt` is not one, and
an accidental `touch` never costs you a sprint.

If the inbox holds at least one item, that sprint becomes a **feedback
sprint** (`NN-feedback`) and is planned from those items instead of from the
vision. The test is the state of the folder, not the age of the files: every
item still sitting there is triaged, whether you dropped it a minute ago or
three sprints ago. Since the loop archives each item as it handles it (see
below), the inbox empties itself and the sprint after a feedback sprint is a
normal one again — unless you have dropped something new in the meantime.

A feedback sprint outranks both cleanup triggers, and a pending `--cleanup`
moves to the next sprint the run creates (with the default `--max-sprints 1`
there is none, and the run says so).

Step F2 replaces step 2 and asks the question step 2 cannot: **is this
already captured in `docs/vision.md`, or does the product itself need to
change?** Each item gets exactly one disposition, recorded by filename in
the sprint focus:

- **in-vision** — the vision already covers it; the gap is execution. This
  is what the sprint's focus is built from.
- **vision-change** — the vision does not cover it, or your feedback
  contradicts it. `docs/vision.md` is yours and the loop never edits it, so
  the item comes back as a written proposal in the sprint focus and the
  report, and only vision-compatible work is taken on now.
- **declined** — out of scope, already done, or not worth it, with the
  reason written down.

The focus file's first line stamps the outcome (`_Feedback: triaged=yes,
actionable=yes, vision-change=proposed_`), and the orchestrator checks that
stamp against the dispositions rather than believing it: every item must
have its own section with exactly one disposition, and `actionable=none` is
only accepted when nothing is `in-vision`. `none` is then a valid, cheap
result — the loop skips the spec and tickets entirely rather than inventing
work. Everything else — spec, tickets, implement/review, UX pass, report,
vision status, the sprint branch and its merge — is the normal machinery.

`docs/vision.md` stays yours: the triage step fails outright if it edits the
vision (or anything under `docs/feedback/`), so a proposal can never quietly
become a change. The run tells you what it decided (`📮 sprint 02 feedback:
1 in-vision, 1 vision-change, 1 declined`), the report renders a proposed
vision change as prominently as a blocked ticket, and `vision_status.md`
keeps it under "Blocked on human" every sprint until you act on it.

Once triaged, each item is moved to `docs/feedback/handled/NN-<name>.md` —
your words, untouched, filed under the sprint that handled them; what was
decided about each one lives in that sprint's `sprint_focus.md` and in the
report. To re-open an item, move the file back. Feedback dropped while a
sprint is running waits for the next sprint boundary — a sprint's scope
never shifts under the steps already running against it.

### Crash safety and resume

There is no state file. On every `run`, the orchestrator derives the current
phase purely from what's on disk: which sprint folders exist, each ticket's
`done`/`reviewed`/`needs_human_intervention` fields, the
`_Ticketized: no|yes_` stamp on `ux_findings.md`, the `_Feedback:
triaged=no|yes_` stamp on a feedback sprint's `sprint_focus.md`, whether the
report contains
`<section id="sprint-NN">`, and the `_Last updated: sprint NN_` stamp on
`vision_status.md`. Kill the loop at any point and rerun — it re-enters
exactly where the files say it left off. This is also why `.working/` must
stay tracked in git.

Usage limits are waited out, not fatal: when a `claude` run dies because the
account hit its usage/rate limit, the loop parses the reset time out of the
message when it carries one, prints a single line saying how long it will
wait and when it resumes, sleeps, and re-runs the same attempt — without
consuming the postcondition retry. Killing the process during the wait loses
nothing (rerun and it derives the same step). The knobs live in the
`RATE_LIMIT` constant in `scripts/mmm-loop/config.ts`; the env vars
`MMM_LOOP_RL_DEFAULT_WAIT_MS` and `MMM_LOOP_RL_RESET_MARGIN_MS` override the
waits for one-off runs.

## Tuning

All knobs live in the copy inside your project:

- **`scripts/mmm-loop/config.ts`** — per-step model, reasoning effort, and
  max turns (defaults: Fable 5 at max effort for planning/implement/review,
  Haiku for the mechanical vision-status rewrite), the cleanup-sprint cadence
  (`CLEANUP_CADENCE`, default every 3rd sprint), the base branch that sprint
  branches are created from and merged into (`BASE_BRANCH`, default `main`),
  plus the permission flags passed to `claude`. The default is
  `--dangerously-skip-permissions`; swap in `--permission-mode acceptEdits`
  and an allowlist if that's too spicy for a project.
- **`ALLOWED_CLAUDE_USER`** (also in `config.ts`) — pin the loop to one
  Claude account: when set to an email, a run aborts at startup unless that
  account is logged in (case-insensitive), so an overnight run can't bill
  the wrong subscription. Default `null` = accept any account. The
  `MMM_LOOP_ALLOWED_CLAUDE_USER` env var overrides per run (empty string =
  accept any).
- **`scripts/mmm-loop/prompts/*.md`** — the thirteen step prompts. Editing
  them per project is normal and expected.

## Developing mmm-loop itself

```bash
bun install
bun test        # unit + per-step + e2e dry runs with a fake `claude`
bunx tsc --noEmit
```

The e2e tests drive the real CLI against throwaway git projects using
`tests/fixtures/fake-claude.ts` (injected via `MMM_LOOP_CLAUDE_BIN`), which
dispatches canned per-step behaviors from `tests/fixtures/scenarios/`.
