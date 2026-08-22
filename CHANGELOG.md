# Changelog

Notable changes to mmm-loop, newest first, one `##` section per release.

Every section ends with **Upgrade notes**: what a human has to do by hand to
move a project onto that release. `update` reads them straight out of this
file for the span it is about to jump, so they are written for the person
running the update, not for a reader of history.

Versions are [semver](https://semver.org) with a leading `v`; see
[Versioning policy](README.md#versioning-policy) for what a bump promises.
The engine's own version lives in `scripts/mmm-loop/engine/VERSION` and is
what `bun scripts/mmm-loop/loop.ts version` prints.

## c324ef3 → v0.1.0 (2026-08-22)

First tagged release. It covers the 26 commits from the initial commit
`c324ef3` (2026-08-08) to the tag, and it is the release that *defines*
mmm-loop's public surface: `LoopConfig`, the install/update contract, and the
on-disk [state contract](docs/specification.md#33-the-state-contract).

### Distribution: the bundle is now engine + overlay

`scripts/mmm-loop/` no longer is one editable copy. It separates what
upstream owns from what the project owns:

```
scripts/mmm-loop/
  loop.ts      one-line shim into the engine
  config.ts    the project overlay — yours
  prompts/     project prompt overrides — yours
  engine/      upstream's; replaced wholesale by `update`
```

- **`engine/`** holds everything shipped (`loop.ts`, `lib/`, `prompts/`, and
  the old `config.ts` as `defaults.ts`) plus a `VERSION` file. It is deleted
  and re-copied on every update, so nothing in it may be edited.
- **`config.ts`** exports `config: Partial<LoopConfig>`, deep-merged over
  `engine/defaults.ts` by `engine/config.ts`. Unknown top-level keys warn and
  are ignored — a stale key must never stop a run.
- **`prompts/<id>.md`** shadows `engine/prompts/<id>.md`. A project can fork
  one prompt without forking the engine. `resolvePrompt()` is the only thing
  that turns a step id into a file, and the resolved path is printed in the
  step banner and in the message when a step dies on its postcondition — so
  an override can never take effect unnoticed.

### New commands

- **`version`** — one line: the engine version plus how far the two overlays
  have drifted from it (`v0.1.0 (engine) · 0 prompt overrides · 1 config
  override`).
- **`install <target>`** — create a bundle in another project: engine, shim,
  starter overlay with `source` pinned to where it came from, empty
  `prompts/`. Create-only; it refuses when a bundle is already there and it
  does not scaffold `docs/` or `.working/` (that is `init`'s job).
- **`update [--apply] [--from <path-or-url>]`** — replace `engine/` wholesale
  from the pinned source, leaving the overlay alone. A dry run unless given
  `--apply`. It refuses on an unclean bundle (an applied update must be one
  reviewable commit that `git checkout` undoes) and while a sprint branch is
  in flight (swapping the engine mid-sprint changes the rules mid-game). It
  never runs `init` — it names the scaffold files a new engine would add and
  stops. It also names every prompt override whose upstream original changed
  or was removed in the span, on dry runs too, and prints the source's
  upgrade notes for the span.

### New sprint types

- **Cleanup sprints** (`NN-cleanup`, steps C3/C4). A second sprint type that
  finds and executes the most obvious improvement in each of three categories
  — architecture, clean-code, docs — reusing the ticket/implement/review/UX/
  report machinery unchanged. Triggered by `run --cleanup` (the first sprint
  that run *creates*) or by `CLEANUP_CADENCE` (default: every 3rd sprint,
  `0` disables). C3 writes a `spec.md` whose first line is the candidates
  stamp; C4 runs once per `yes` category with fixed ids `001`/`002`/`003`.
  The bar is deliberately high — **finding nothing is a successful outcome**,
  and the empty sprint still runs its UX pass as a regression check. Category
  tickets commit as `refactor()`/`docs()` instead of `feat()`.
- **Feedback sprints** (`NN-feedback`, step F2). Drop a markdown file into
  `docs/feedback/inbox/` and the next sprint the loop *creates* is planned
  from what you wrote instead of from the vision. F2 gives every item exactly
  one disposition — in-vision, vision-change (a written proposal, never an
  edit), or declined — and stamps the outcome on `sprint_focus.md`; the
  orchestrator checks the stamp against the dispositions rather than
  believing it. `actionable=none` skips spec and tickets entirely. Feedback
  outranks both cleanup triggers and does not consume a pending `--cleanup`.
  `docs/vision.md` stays human-authored: the step fails outright if it edits
  the vision or anything under `docs/feedback/`. Items are archived to
  `docs/feedback/handled/NN-<name>.md` as they are handled.

### New step in every sprint

- **UX pass (step 5.5)**, between the implement loop and the report: plan
  (5.5.1), execute (5.5.2), and ticketize (5.5.3) an agentic UX test of the
  sprint's delta, so experience problems are fixed in the same sprint. UX
  tickets (`NNN-ux-slug.json`) route through the normal implement/review
  loop. Exactly one pass per sprint — the report's `<section id="sprint-NN">`
  is the pass's done-marker, which is what bounds it even when its own
  tickets send the loop back to implement. Report and vision status now
  surface unresolved UX findings.

### Running unattended

- **A branch per sprint.** Each sprint runs on an orchestrator-managed
  `sprint/NN` branch created from `BASE_BRANCH`, merged back with a `--no-ff`
  merge commit and deleted when the sprint completes clean, left checked out
  and unmerged when it ends blocked — so `git diff main..sprint/NN` is the
  whole sprint, reviewable in one sitting. At most one sprint branch exists
  at a time: the branch list *is* the state, so every crash window is
  idempotent on rerun.
- **Usage limits are waited out, not fatal.** A `claude` run that dies on a
  usage limit is detected from its output tail, logged as one line (how long
  it will wait, when it resumes), slept off, and re-run — without consuming
  the §6.3 postcondition retry. Zero-exit runs are never classified (the
  false-positive guard), and after `maxConsecutiveWaits` limited attempts the
  step dies naming the step and the count. Knobs live in the `RATE_LIMIT`
  config value; `MMM_LOOP_RL_DEFAULT_WAIT_MS` and
  `MMM_LOOP_RL_RESET_MARGIN_MS` override for one-off runs.
- **Wrong-account guard.** `ALLOWED_CLAUDE_USER` pins a project to one Claude
  account: when set, step 1 aborts with exit 1 unless that account is logged
  in (case-insensitive), so an overnight run cannot bill the wrong
  subscription. Default `null` accepts any account and short-circuits before
  touching the filesystem. `MMM_LOOP_ALLOWED_CLAUDE_USER` overrides (empty
  string = accept any).
- **Informative console output.** A per-step banner before every spawn (emoji
  + the step's description + model/effort/max-turns + the resolved prompt
  path), a `✓ step X done (4m 12s)` line after it, and emoji/color on the
  orchestrator's event lines. All styling degrades to plain text when stdout
  is not a TTY or `NO_COLOR` is set, so piped and CI output stays stable.

### Changed

- Agent stdout/stderr is teed through bounded 64 KB tails instead of
  inheriting stdio — live output is unchanged, but the tail is what
  classifies usage limits.
- The 12 anonymous postcondition closures became named, exported, IO-free
  functions in `lib/postconditions.ts` taking plain before/after
  observations; `steps.ts` performs no read IO of its own. The two ADRs this
  rests on are in `docs/adr/`.
- Ticket filename shapes and numbering moved into `lib/tickets.ts`;
  `snapshot.ts` owns the postcondition readers.
- `CLEANUP_CADENCE`, `BASE_BRANCH`, `ALLOWED_CLAUDE_USER`, `RATE_LIMIT` and
  the optional `source` pin joined `STEP_CONFIG` and `PERMISSION_ARGS` in the
  config surface, now typed as `LoopConfig`.
- Exit 1 gained causes: wrong Claude account, wrong branch at startup, a
  broken sprint-branch invariant, and a sprint-merge conflict.

### Fixed

- `stepUxTickets` no longer crashes on a pathspec for a sprint with no
  `tickets/` directory (reachable via a zero-candidate cleanup sprint).
- A stray subdirectory under `tickets/` is ignored instead of producing a
  confusing "filename must match" error or an `EISDIR` throw.

### State contract

Additive only — nothing that existed at `c324ef3` changed shape.

- **Added** sprint-folder artifacts `ux_test_plan.md` and `ux_findings.md`.
- **Added** stamps: `_Ticketized: no|yes_` (first line of `ux_findings.md`),
  `_Candidates: architecture=…, clean-code=…, docs=…_` (first line of a
  cleanup `spec.md`), `_Feedback: triaged=…, actionable=…, vision-change=…_`
  (first line of a feedback `sprint_focus.md`).
- **Added** reserved sprint slugs: `cleanup` and `feedback`. A sprint folder
  named exactly `NN-cleanup` or `NN-feedback` is that sprint type.
- **Added** ticket filename infix `ux-` for UX tickets (`NNN-ux-slug.json`);
  it is a slug convention, not a schema change.
- **Unchanged**: the ticket JSON schema, `_Last updated: sprint NN_` on
  `vision_status.md`, `<section id="sprint-NN">` in `sprint_reports.html`,
  and `NNN-slug.json` / `NNN.1-slug.json` filename ordering.

### Upgrade notes

Moving a project off a pre-split (`c324ef3`-era) copy of the bundle. There is
no automatic path: `update` requires the project to already have an
`engine/`, and it refuses a pre-split bundle by name. Do it by hand, once.

1. **Record your local edits first.** `git diff` the old
   `scripts/mmm-loop/` against `c324ef3` (or whatever you copied from) and
   note which prompts and which `config.ts` constants you changed. You will
   re-apply them in step 4.
2. **Replace the bundle.** `install` is create-only, so remove the old one:
   `rm -rf scripts/mmm-loop`, then from the mmm-loop checkout
   `bun scripts/mmm-loop/loop.ts install <your-project>`. That writes the
   shim, `engine/`, a starter `config.ts` with `source` pinned, and an empty
   `prompts/`. From then on `bun scripts/mmm-loop/loop.ts update` keeps you
   current and this manual step never repeats.
3. **Scaffold the new files:** `bun scripts/mmm-loop/loop.ts init`. It never
   overwrites, so it only adds what is missing — for this span that is
   `docs/feedback/README.md`, `docs/feedback/inbox/.gitkeep`, and
   `docs/feedback/handled/.gitkeep`. The feedback folders are optional;
   delete them and nothing breaks, but then no sprint is ever a feedback
   sprint.
4. **Re-apply your edits onto the overlay, not into `engine/`.** Config
   changes become fields of the exported `config` object in
   `scripts/mmm-loop/config.ts` (`export const config: Partial<LoopConfig> =
   { BASE_BRANCH: "master", … }`) instead of top-level `export const`s;
   widen the type to `LoopConfigOverlay` if you want to override a single
   step or a single `RATE_LIMIT` field. Prompt changes become
   `scripts/mmm-loop/prompts/<id>.md` — copy the *new* engine prompt from
   `engine/prompts/<id>.md` and re-apply your edit on top of it, rather than
   restoring your old file: the prompts moved a lot in this span, and a fork
   of the old text will issue stale instructions to a step whose
   postcondition has moved. Put a file there only for prompts you actually
   changed; every one is a maintenance cost that `update` will warn you
   about later.
5. **Give the run a base branch.** Sprints now run on `sprint/NN` branches
   cut from `BASE_BRANCH` (default `main`). Before the first run: be on that
   branch, with at least one commit, and with no leftover `sprint/*` branch.
   A project that has run pre-branch sprints is adopted automatically — the
   first step dispatch creates the sprint branch at `HEAD`.
6. **Nothing to migrate on disk.** Existing sprint folders, tickets and
   reports are read by the new engine as-is: the ticket JSON schema is
   unchanged, and a finished old sprint (report section present, no UX
   files) still derives as complete. Only rename a sprint folder if it is a
   normal sprint literally named `NN-cleanup` or `NN-feedback` — those slugs
   are now reserved and would make the loop treat it as the wrong type.
7. **Check the two new refusals before an overnight run.** If you set
   `ALLOWED_CLAUDE_USER`, confirm `claude` is logged in as that account, or
   step 1 exits 1 before anything spawns. And keep `.working/` tracked in
   git — phase derivation reads it, there is still no state file.
