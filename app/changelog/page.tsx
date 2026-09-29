import { readFileSync } from "node:fs";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { parseChangelog, parseInline, type ChangeEntry, type ChangeKind } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog — NVBC Courts",
  description: "What's new and improved at NV Badminton Center's court booking site.",
};

// Built from CHANGELOG.md at deploy time, so the page always matches what's live.
export const dynamic = "force-static";

const KIND: Record<ChangeKind, { label: string; icon: string }> = {
  Added: { label: "New", icon: "✨" },
  Changed: { label: "Improved", icon: "🔧" },
  Fixed: { label: "Fixed", icon: "🐞" },
  Removed: { label: "Removed", icon: "🗑️" },
};

function Text({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((t, i) =>
        t.type === "bold" ? <strong key={i}>{t.text}</strong>
        : t.type === "code" ? <code key={i}>{t.text}</code>
        : t.type === "link" ? (t.href.startsWith("/") ? <Link key={i} href={t.href}>{t.text}</Link> : <a key={i} href={t.href} rel="noopener noreferrer">{t.text}</a>)
        : <span key={i}>{t.text}</span>
      )}
    </>
  );
}

const niceDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export default function ChangelogPage() {
  let md = "";
  try {
    md = readFileSync(path.join(process.cwd(), "CHANGELOG.md"), "utf8");
  } catch {
    /* no changelog file: show the empty state */
  }
  const releases = parseChangelog(md);

  return (
    <div className="changelog">
      <h1>What&apos;s new</h1>
      <p className="lead">The latest improvements to booking courts, payments and memberships at NVBC.</p>

      {releases.length === 0 && <p className="muted">No updates to show yet.</p>}

      {releases.map((r) => {
        const forAll = r.groups.map((g) => ({ ...g, entries: g.entries.filter((e) => !e.staff) })).filter((g) => g.entries.length);
        const forStaff: { kind: ChangeKind; entry: ChangeEntry }[] = r.groups.flatMap((g) =>
          g.entries.filter((e) => e.staff).map((entry) => ({ kind: g.kind, entry }))
        );
        return (
          <section key={r.title + (r.date ?? "")} className="card cl-release">
            <h2>{r.date ? niceDate(r.date) : r.title}</h2>
            {forAll.map((g) => (
              <div key={g.kind} className="cl-group">
                <h3><span aria-hidden="true">{KIND[g.kind].icon}</span> {KIND[g.kind].label}</h3>
                <ul>
                  {g.entries.map((e, i) => <li key={i}><Text text={e.text} /></li>)}
                </ul>
              </div>
            ))}
            {forStaff.length > 0 && (
              <details className="cl-staff">
                <summary>For NVBC staff ({forStaff.length})</summary>
                <ul>
                  {forStaff.map(({ kind, entry }, i) => (
                    <li key={i}>
                      <span className={`cl-tag ${kind.toLowerCase()}`}>{KIND[kind].label}</span> <Text text={entry.text} />
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
