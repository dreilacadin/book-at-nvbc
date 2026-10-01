"use client";

import { useCallback, useEffect, useState } from "react";
import ChatThread, { type ChatMessage } from "@/components/ChatThread";
import { api, type AdminBooking } from "./shared";

/** Staff: the booking's messages with the customer, on the booking card. Refreshes while open. */
export default function BookingMessages({ b, onAuthError }: { b: AdminBooking; onAuthError: (e: unknown) => void }) {
  const [open, setOpen] = useState(b.message_count > 0);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setMessages((await api<{ messages: ChatMessage[] }>(`/api/admin/messages?booking=${b.id}`)).messages);
      setError("");
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : "Couldn't load messages.");
    }
  }, [b.id, onAuthError]);
  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => clearInterval(t);
  }, [open, load]);

  const reach = [b.alert_devices > 0 ? "notification" : "", b.customer_email ? "email" : ""].filter(Boolean).join(" and ");
  return (
    <details className="bk-messages" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        💬 Messages{b.message_count ? ` (${b.message_count})` : ""}
        {b.unread_messages > 0 && !messages && <span className="chip warn" style={{ marginLeft: 8 }}>{b.unread_messages} new</span>}
      </summary>
      {error && <div className="error">{error}</div>}
      {messages && (
        <ChatThread
          messages={messages}
          side="staff"
          placeholder={`Message ${b.name}…`}
          empty={
            <>
              No messages yet. Write to {b.name} here — they see it on their booking page
              {reach ? ` and get a ${reach}` : " (they haven't turned on updates, so they'll only see it when they open their booking)"}.
            </>
          }
          onSend={async (body) => {
            try {
              setMessages((await api<{ messages: ChatMessage[] }>("/api/admin/messages", { booking: b.id, body })).messages);
              return null;
            } catch (e) {
              onAuthError(e);
              return e instanceof Error ? e.message : "Couldn't send.";
            }
          }}
        />
      )}
    </details>
  );
}
