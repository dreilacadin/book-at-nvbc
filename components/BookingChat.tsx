"use client";

import { useCallback, useEffect, useState } from "react";
import ChatThread, { type ChatMessage } from "./ChatThread";

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

/** My booking: questions to NVBC staff about this booking, and their replies. Refreshes while open. */
export default function BookingChat({ code }: { code: string }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);

  const load = useCallback(async () => {
    try {
      setMessages((await call({ code, action: "list" })).messages);
    } catch {
      /* try again on the next refresh */
    }
  }, [code]);
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 20_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="chat-box" id="booking-chat">
      <strong>💬 Messages with NVBC staff</strong>
      {messages && (
        <ChatThread
          messages={messages}
          side="customer"
          placeholder="Ask about your booking, payment or anything else…"
          empty="Questions about this booking? Send NVBC staff a message — they'll reply here (and by notification or email if you turned updates on)."
          onSend={async (body) => {
            try {
              setMessages((await call({ code, action: "send", body })).messages);
              return null;
            } catch (e) {
              return e instanceof Error ? e.message : "Couldn't send. Please try again.";
            }
          }}
        />
      )}
    </div>
  );
}
