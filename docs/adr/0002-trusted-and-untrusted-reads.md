---
status: accepted
---

# Reads of orchestrator state throw; reads of agent output report

The loop reads the filesystem for two different reasons, and they need opposite error policies.

When the orchestrator reads a **loop artifact it wrote itself** — a committed ticket, a stamped
`ux_findings.md`, the sprint layout phase derivation walks — it is reading data whose invariants
it maintains. A missing or malformed artifact there is a bug in the loop, and must fail loudly
rather than be papered over.

When a **postcondition** reads what an agent just produced, it is reading untrusted output.
Missing, malformed and misnamed are all expected outcomes: they must become the text fed back to
the agent on its one retry, never an exception.

So the codebase deliberately carries pairs that look like duplicates and must not be merged:

| Trusted (throws) | Untrusted (reports) |
|---|---|
| `snapshot.ts` — `readTicketFile` | `postconditions.ts` — `parseTicket` |
| `snapshot.ts` — `readRequiredTextFile` | `snapshot.ts` — `readTextFile` |

The cost of getting this wrong is not theoretical. The first draft of the postconditions
refactor replaced `readFileSync(findingsPath, "utf8")` with `readTextFile(findingsPath) ?? ""`
at both of step 5.5.3's trusted reads. Under that change, a missing `ux_findings.md` would have
spawned the ticketize agent with an empty findings variable, and then written `_Ticketized: yes_`
into an otherwise empty file and committed it — the orchestrator manufacturing the very state it
was supposed to be reading, silently. `?? ""` is the untrusted idiom; it does not belong on a
trusted read.

The two words for this are **Observation** (the untrusted before/after data a postcondition
judges) and **Snapshot** (the trusted project state phase derivation reads). Both module headers
— `lib/snapshot.ts` and `lib/postconditions.ts` — restate the split at the point of use.
