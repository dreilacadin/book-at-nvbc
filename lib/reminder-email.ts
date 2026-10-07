// The "your membership has expired" reminder email. Shared by the admin page (editing, preview)
// and the server (sending). No Node-only imports.

export const REMINDER_PLACEHOLDERS = [
  { key: "first_name", hint: "Ana" },
  { key: "name", hint: "Ana Cruz" },
  { key: "expired_on", hint: "August 20, 2026" },
  { key: "fee", hint: "₱600" },
  { key: "member_code", hint: "NVBC-7K3Q-9PXM" },
  { key: "member_page", hint: "their private member-card link" },
] as const;
export type ReminderVars = Record<(typeof REMINDER_PLACEHOLDERS)[number]["key"], string>;

export const DEFAULT_REMINDER_SUBJECT = "Your NVBC membership has expired — renew on your next visit";

export const DEFAULT_REMINDER_BODY = `Hi {first_name},

Your NVBC membership expired on {expired_on}. We'd love to keep you on court! Drop by the front desk on your next visit to renew for another year ({fee}) — you'll keep the same member code ({member_code}) and member rates.

If you'd rather not renew, just let us know at the desk.

Your member card: {member_page}

See you at NVBC! 🏸`;

/** Replaces {placeholders}; unknown ones are left as typed so mistakes are visible in the preview. */
export function fillTemplate(template: string, vars: ReminderVars): string {
  return template.replace(/\{(\w+)\}/g, (m, key: string) => (key in vars ? vars[key as keyof ReminderVars] : m));
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain text → simple HTML email: paragraphs, line breaks, and clickable links. */
export function textToHtml(text: string): string {
  const paras = text
    .trim()
    .split(/\n{2,}/)
    .map((p) => {
      const safe = escapeHtml(p).replace(/\n/g, "<br>");
      const linked = safe.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:#1e274b">${url}</a>`);
      return `<p style="margin:0 0 14px">${linked}</p>`;
    })
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#000023;max-width:560px">${paras}</div>`;
}

export const niceLongDate = (d: string) =>
  new Date(d + "T00:00:00Z").toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
