import nodemailer, { type Transporter } from "nodemailer";
import { textToHtml } from "./reminder-email";

// Sends email through a Gmail account (GMAIL_USER + a Gmail app password). Server only.
// To use another provider later (e.g. the club's own domain), also set SMTP_HOST and SMTP_PORT.

export function emailSender(): { address: string; name: string } | null {
  const address = process.env.GMAIL_USER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");
  if (!address || !password) return null;
  return { address, name: process.env.EMAIL_FROM_NAME?.trim() || "NVBC" };
}

const globalForMail = globalThis as unknown as { __nvbcMail?: Transporter };

function transport(): Transporter {
  if (!globalForMail.__nvbcMail) {
    const auth = { user: process.env.GMAIL_USER!.trim(), pass: process.env.GMAIL_APP_PASSWORD!.replace(/\s/g, "") };
    const host = process.env.SMTP_HOST?.trim();
    const port = Number(process.env.SMTP_PORT) || 465;
    globalForMail.__nvbcMail = nodemailer.createTransport({
      ...(host ? { host, port, secure: port === 465 } : { service: "gmail" }),
      auth,
      pool: true, // reuse one connection for a batch
      maxConnections: 1,
    });
  }
  return globalForMail.__nvbcMail;
}

export type Attachment = { filename: string; content: string; contentType: string };

/** Sends one email (plain text plus a simple HTML version). Throws a readable error on failure. */
export async function sendEmail(to: string, subject: string, text: string, attachments: Attachment[] = []): Promise<void> {
  const from = emailSender();
  if (!from) throw new Error("Email isn't set up yet (GMAIL_USER and GMAIL_APP_PASSWORD).");
  try {
    await transport().sendMail({
      from: { name: from.name, address: from.address },
      replyTo: from.address,
      to,
      subject,
      text,
      html: textToHtml(text),
      attachments,
    });
  } catch (e) {
    const err = e as { code?: string; responseCode?: number; message?: string };
    if (err.code === "EAUTH" || err.responseCode === 535)
      throw new Error("Gmail refused the login. Check GMAIL_USER and that GMAIL_APP_PASSWORD is an app password (not your normal password).");
    if (err.responseCode === 550 || err.responseCode === 553) throw new Error(`Gmail rejected the address ${to}.`);
    if (err.responseCode === 421 || err.responseCode === 454)
      throw new Error("Gmail's sending limit was reached. Try the rest tomorrow.");
    throw new Error(err.message || "Sending failed.");
  }
}
