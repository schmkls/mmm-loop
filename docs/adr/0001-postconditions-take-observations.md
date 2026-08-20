---
status: accepted
---

# Postconditions take per-step observations, not SprintSnapshot

A step's postcondition judges what the agent left on disk. The obvious data to hand it is the
`SprintSnapshot` that `lib/snapshot.ts` already builds and that phase derivation already uses,
and that is what the architecture review proposed. We rejected it: `readSprint` builds
`tickets` via `readTicketFile`, which **throws `LoopError`** on malformed JSON and on schema
violations, and it pre-filters filenames through `TICKET_FILENAME_RE`, so a misnamed file is
silently dropped rather than reported. Those three failures — malformed, invalid, misnamed —
are precisely what steps 4, C4, 5.2 and 5.5.3 exist to catch, so a `SprintSnapshot` cannot
represent the inputs those rules are for. It is the wrong type by construction, not merely an
inconvenient one.

So `lib/postconditions.ts` defines its own observation shapes — three of them: file contents as
`string | null`, a `FilesDelta` of raw filename→contents maps, and a sprint-directory listing.
They are deliberately raw: byte comparison is what detects "this ticket was modified", so the
maps hold unparsed text, and each rule parses only what it needs and reports rather than throws.

**Consequence.** `snapshot.ts` and `postconditions.ts` will look like they duplicate work —
both read tickets, in different shapes, with different error policies. They do not. Merging
them deletes four rules. See ADR 0002 for the error-policy half of the same boundary.
