"use client";

import { useCallback, useEffect, useState } from "react";
import ChatThread, { type ChatMessage } from "./ChatThread";
import { Fold } from "./BookingSummary";

async function call(body: Record<string, unknown>): Promise<{ messages: ChatMessage[] }> {
  const res = await fetch("/api/bookings/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

/**
 * Questions to NVBC staff about this booking, and their replies. Opens by itself when there are
 * new messages; loads (and marks staff messages as read) only while open, refreshing every 20 s.
 */
export default function BookingChat({ code, unread = 0 }: { code: string; unread?: number }) {
  const [open, setOpen] = useState(unread > 0);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);

  const load = useCallback(async () => {
    try {
      setMessages((await call({ code, action: "list" })).messages);
    } catch {
      /* try again on the next refresh */
    }
  }, [code]);
  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => clearInterval(t);
  }, [open, load]);

  const fresh = messages ? 0 : unread;
  return (
    <Fold id="booking-chat" icon="💬" title="Message NVBC staff" defaultOpen={unread > 0} onToggle={setOpen}
      hint={fresh > 0 ? `${fresh} new` : messages?.length ? String(messages.length) : undefined} hintTone={fresh > 0 ? "new" : undefined}>
      {messages ? (
        <ChatThread
          messages={messages}
          side="customer"
          placeholder="Ask NVBC staff…"
          empty="Questions about this booking? Send NVBC staff a message — they'll reply here (and by notification or email if you turned on updates)."
          onSend={async (body) => {
            try {
              setMessages((await call({ code, action: "send", body })).messages);
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : "Couldn't send. Please try again.";
            }
          }}
        />
      ) : (
        <p className="hint" style={{ margin: 0 }}>Loading…</p>
      )}
    </Fold>
  );
}
