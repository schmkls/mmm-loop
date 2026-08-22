/**
 * Reading a source's CHANGELOG.md so `update` can show what a human must do
 * by hand across the span it is about to jump.
 *
 * The shape this expects — one `##` heading per release, newest first, with
 * an optional `### Upgrade notes` subsection:
 *
 *     # Changelog
 *
 *     ## c324ef3 → v0.1.0
 *     ...
 *     ### Upgrade notes
 *     - move X to Y
 *
 * The heading may say anything as long as it ends with the version it
 * introduces (`## v0.2.0`, `## v0.1.0 → v0.2.0`, `## 2026-08-22 v0.2.0` all
 * work). Everything here is best-effort: a missing, differently-shaped, or
 * unparseable CHANGELOG must never stop an update, only make it quieter.
 */

/** `v0.1.0`, `0.1.0`, `1.2.3-rc.1`, `0.0.0-dev`. */
const VERSION_RE = /v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/g;

export interface ChangelogSection {
  /** The version this section introduces — the last version in its heading. */
  version: string | null;
  heading: string;
  body: string;
}

/**
 * A version string reduced to the part that can be compared with a heading's.
 * `engine/VERSION` carries provenance as well as the number
 * (`v0.1.0 (2026-08-22, abc1234)`), so match on the first version token in
 * it; anything with no token at all compares as itself.
 */
function normalize(version: string): string {
  const found = version.match(VERSION_RE);
  return (found?.[0] ?? version).replace(/^v/i, "").toLowerCase();
}

/** Split a CHANGELOG into its `##` sections, in file order (newest first).
 * Anything before the first `##` (the title) is dropped. */
export function parseChangelog(text: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | null = null;
  for (const line of text.split("\n")) {
    const heading = /^## +(.*\S)\s*$/.exec(line);
    if (heading) {
      const title = heading[1]!;
      const versions = title.match(VERSION_RE);
      current = { version: versions ? versions[versions.length - 1]! : null, heading: title, body: "" };
      sections.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  return sections;
}

/**
 * The sections covering `from` (exclusive) → `to` (inclusive), newest first.
 * An unknown `to` starts at the newest section; an unknown `from` — the
 * usual case when a project is many versions behind, or on `v0.0.0-dev` —
 * reaches all the way back, which errs toward showing too much.
 */
export function sectionsInSpan(
  sections: ChangelogSection[],
  from: string,
  to: string,
): ChangelogSection[] {
  const indexOf = (v: string): number =>
    sections.findIndex((s) => s.version !== null && normalize(s.version) === normalize(v));
  const iTo = Math.max(indexOf(to), 0);
  const iFrom = indexOf(from);
  return iFrom === -1 ? sections.slice(iTo) : sections.slice(iTo, Math.max(iFrom, iTo));
}

/** The `### Upgrade notes` subsection of a section body, or null. */
export function upgradeNotesOf(body: string): string | null {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^### +upgrade notes\s*$/i.test(l));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{2,3} /.test(l));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return notes === "" ? null : notes;
}

/**
 * The upgrade notes for the `from` → `to` span, ready to print, or null when
 * the span carries none. Each block is headed by the release it came from so
 * a multi-version jump stays readable.
 */
export function upgradeNotes(changelog: string, from: string, to: string): string | null {
  const blocks: string[] = [];
  for (const section of sectionsInSpan(parseChangelog(changelog), from, to)) {
    const notes = upgradeNotesOf(section.body);
    if (notes !== null) blocks.push(`## ${section.heading}\n\n${notes}`);
  }
  return blocks.length === 0 ? null : blocks.join("\n\n");
}
