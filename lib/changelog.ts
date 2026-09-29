// Reads CHANGELOG.md into releases for the public /changelog page. No Node-only imports.
//
// Conventions in CHANGELOG.md:
//   ## [Unreleased]  or  ## 2026-09-30        → a release (Unreleased shows as "Latest updates")
//   ### Added | Changed | Fixed | Removed     → a group
//   - item text (continuation lines indented) → an entry
//   Entries starting "**Staff:**" are shown in a "For NVBC staff" section;
//   entries starting "**Database:**" or "**Internal:**" are not shown publicly.

export type ChangeKind = "Added" | "Changed" | "Fixed" | "Removed";
export type ChangeEntry = { text: string; staff: boolean };
export type Release = { title: string; date: string | null; groups: { kind: ChangeKind; entries: ChangeEntry[] }[] };

const KINDS: ChangeKind[] = ["Added", "Changed", "Fixed", "Removed"];

export function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let group: Release["groups"][number] | null = null;
  let entry: string[] | null = null;

  const flush = () => {
    if (!entry || !group) return (entry = null);
    const text = entry.join(" ").replace(/\s+/g, " ").trim();
    entry = null;
    if (/^\*\*(Database|Internal):?\*\*/i.test(text)) return;
    const staff = /^\*\*Staff:?\*\*/i.test(text);
    group.entries.push({ text: staff ? text.replace(/^\*\*Staff:?\*\*\s*/i, "") : text, staff });
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h2 = /^##\s+(.+)$/.exec(line);
    const h3 = /^###\s+(.+)$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      flush();
      const label = h2[1].replace(/^\[|\]$/g, "").trim();
      const date = /\d{4}-\d{2}-\d{2}/.exec(label)?.[0] ?? null;
      release = { title: /unreleased/i.test(label) ? "Latest updates" : label, date, groups: [] };
      releases.push(release);
      group = null;
    } else if (h3) {
      flush();
      const kind = KINDS.find((k) => k.toLowerCase() === h3[1].trim().toLowerCase());
      group = release && kind ? { kind, entries: [] } : null;
      if (group) release!.groups.push(group);
    } else if (/^\s*[-*]\s+/.test(line) && group) {
      flush();
      entry = [line.replace(/^\s*[-*]\s+/, "")];
    } else if (entry && /^\s+\S/.test(line)) {
      entry.push(line.trim()); // continuation of the current entry
    } else {
      flush();
    }
  }
  flush();
  // Drop groups/releases left empty after hiding internal entries.
  return releases
    .map((r) => ({ ...r, groups: r.groups.filter((g) => g.entries.length) }))
    .filter((r) => r.groups.length);
}

/** Inline markdown in an entry: **bold**, `code` and [links](url) → tokens (rendered as React, no HTML). */
export type Inline = { type: "text" | "bold" | "code"; text: string } | { type: "link"; text: string; href: string };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "code", text: m[2] });
    else {
      const href = m[4];
      // Only safe links: site paths or http(s). Anything else is shown as plain text.
      if (/^(\/|https?:\/\/)/.test(href)) out.push({ type: "link", text: m[3], href });
      else out.push({ type: "text", text: m[3] });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}
