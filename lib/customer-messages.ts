// What customers are told about their booking, by push notification and email. Pure (no Node
// imports), so it can be tested.
import { formatDateLong, formatRange } from "./format.ts";

export type CustomerNoticeKind = "confirmed" | "rejected" | "upcoming" | "message" | "refunded" | "coaching_accepted" | "coaching_declined";

/** The "coming up" reminder goes out this long before the start. */
export const REMINDER_MINUTES = 60;

export type NoticeBooking = {
  code: string;
  name: string;
  courtName: string;
  date: string;
  startHour: number;
  endHour: number;
  amount: number;
  paymentStatus: string;
  paymentMethod: string;
  status: string;
  rejectedNote: string;
  refundAmount?: number;
  refundRef?: string;
  coachName?: string;
  coachNote?: string;
};

export type CustomerNotice = {
  title: string; // push title
  body: string; // push body (short)
  subject: string; // email subject
  text: string; // email body (plain text)
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
const pesos = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

/**
 * The message for one event. `link` opens the booking (My booking page); `payByClock` ("3:45 PM")
 * is when a rejected booking must be paid by.
 */
export function customerNotice(
  kind: CustomerNoticeKind,
  b: NoticeBooking,
  opts: { link: string; payByClock?: string; message?: string; from?: string }
): CustomerNotice {
  const when = `${formatDateLong(b.date)}, ${formatRange(b.startHour, b.endHour)}`;
  const where = `${b.courtName}, ${when}`;
  const sign = "See you on court!\nNV Badminton Center";

  if (kind === "confirmed") {
    return {
      title: "Booking confirmed ✓",
      body: `Payment received — ${b.courtName}, ${formatRange(b.startHour, b.endHour)} on ${formatDateLong(b.date)}. See you on court!`,
      subject: `Booking confirmed — ${b.courtName}, ${formatDateLong(b.date)}`,
      text:
        `Hi ${firstName(b.name)},\n\nWe've received your payment of ${pesos(b.amount)}, and your booking is confirmed:\n\n` +
        `${where}\nBooking code: ${b.code}\n\nPlease show your booking QR code (or code) at the front desk when you arrive. ` +
        `You can view your booking here:\n${opts.link}\n\n${sign}`,
    };
  }

  if (kind === "rejected") {
    const deadline = opts.payByClock ? ` by ${opts.payByClock}` : "";
    const reason = b.rejectedNote.trim();
    return {
      title: "Payment not accepted — action needed",
      body: `${reason ? `${reason} ` : ""}Please send a correct payment or screenshot${deadline}, or your slot will be released.`,
      subject: `Action needed: we couldn't verify your payment (${b.code})`,
      text:
        `Hi ${firstName(b.name)},\n\nWe couldn't verify the payment you sent for your booking:\n\n${where}\nBooking code: ${b.code}\n\n` +
        (reason ? `Reason: ${reason}\n\n` : "") +
        `We're still holding your slot. Please send a correct payment of ${pesos(b.amount)} and its reference number or screenshot${deadline} ` +
        `on your booking page — otherwise the slot will be released for other players:\n${opts.link}\n\n` +
        `If you think this is a mistake, please contact the front desk.\n\nNV Badminton Center`,
    };
  }

  if (kind === "coaching_accepted" || kind === "coaching_declined") {
    const coach = b.coachName ?? "Your coach";
    const note = b.coachNote?.trim() ? `\n\n${coach} says: “${b.coachNote.trim()}”` : "";
    return kind === "coaching_accepted"
      ? {
          title: "Coaching session confirmed",
          body: `${coach} will coach you on ${formatDateLong(b.date)}, ${formatRange(b.startHour, b.endHour)}.`,
          subject: `${coach} accepted your coaching request (${b.code})`,
          text:
            `Hi ${firstName(b.name)},\n\n${coach} accepted your coaching request for:\n\n${where}\nBooking code: ${b.code}${note}\n\n` +
            `Please pay your coaching fee to ${coach} directly. Your booking: ${opts.link}\n\nNV Badminton Center`,
        }
      : {
          title: "Coaching request declined",
          body: `${coach} can't coach you on ${formatDateLong(b.date)}. Your court booking is still on.`,
          subject: `${coach} can't make your coaching session (${b.code})`,
          text:
            `Hi ${firstName(b.name)},\n\nSorry — ${coach} can't coach you on ${formatDateLong(b.date)}, ${formatRange(b.startHour, b.endHour)}.${note}\n\n` +
            `Your court booking is still on. You can ask another coach from your booking page:\n${opts.link}\n\nNV Badminton Center`,
        };
  }

  if (kind === "refunded") {
    const amount = pesos(b.refundAmount ?? b.amount);
    const ref = b.refundRef ? ` (reference ${b.refundRef})` : "";
    return {
      title: "Refund sent",
      body: `We've refunded ${amount}${ref} for your cancelled booking on ${formatDateLong(b.date)}.`,
      subject: `Your refund for booking ${b.code}`,
      text:
        `Hi ${firstName(b.name)},\n\nWe've sent your refund of ${amount}${ref} for your cancelled booking:\n\n${where}\n` +
        `Booking code: ${b.code}\n\nIt may take a little while to show in your account. If you have any questions, please reply ` +
        `on your booking page or contact the front desk:\n${opts.link}\n\nNV Badminton Center`,
    };
  }

  if (kind === "message") {
    const msg = (opts.message ?? "").trim();
    const short = msg.length > 140 ? `${msg.slice(0, 137)}…` : msg;
    return {
      title: "New message from NVBC",
      body: short,
      subject: `Message about your booking ${b.code}`,
      text:
        `Hi ${firstName(b.name)},\n\n${opts.from ? `${opts.from} from ` : ""}NVBC sent you a message about your booking:\n\n${where}\n` +
        `Booking code: ${b.code}\n\n“${msg}”\n\nYou can reply on your booking page:\n${opts.link}\n\nNV Badminton Center`,
    };
  }

  // upcoming
  const unpaidCash = b.status === "reserved" && b.paymentStatus !== "paid" && b.paymentStatus !== "waived" && b.amount > 0;
  const unverified = b.status === "pending";
  const extra = unpaidCash
    ? ` Please pay ${pesos(b.amount)} at the front desk before you play.`
    : unverified
      ? " Your payment hasn't been confirmed yet."
      : "";
  return {
    title: "Your court time is coming up",
    body: `${b.courtName} at ${formatRange(b.startHour, b.endHour)} today. Show your booking QR at the front desk.${extra}`,
    subject: `Reminder: ${b.courtName} at ${formatRange(b.startHour, b.endHour).split(" – ")[0]} today`,
    text:
      `Hi ${firstName(b.name)},\n\nJust a reminder that your court time is coming up:\n\n${where}\nBooking code: ${b.code}\n\n` +
      `Please show your booking QR code (or code) at the front desk when you arrive.${extra}\n\n` +
      `Can't make it? Please cancel on your booking page so others can play:\n${opts.link}\n\n${sign}`,
  };
}

/** A simple check that an email address looks usable. */
export const isEmail = (v: string) => v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
