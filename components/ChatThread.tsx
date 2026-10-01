"use client";

import { useEffect, useRef, useState } from "react";

export type ChatMessage = { id: number; from: "customer" | "staff"; name: string; body: string; at: string; read: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * A booking's messages as chat bubbles (this side's on the right), with a box to send one. Used on
 * My booking (side "customer") and on the staff booking card (side "staff").
 */
export default function ChatThread({
  messages,
  side,
  onSend,
  placeholder,
  empty,
}: {
  messages: ChatMessage[];
  side: "customer" | "staff";
  onSend: (body: string) => Promise<string | null>; // error message, or null when sent
  placeholder: string;
  empty: React.ReactNode;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?.id;
  // Keep the newest message in view.
  useEffect(() => {
    if (list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [last]);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    const err = await onSend(text);
    setBusy(false);
    if (err) setError(err);
    else setText("");
  }

  return (
    <div className="chat">
      {messages.length === 0 ? (
        <p className="hint chat-empty">{empty}</p>
      ) : (
        <div className="chat-list" ref={list}>
          {messages.map((m) => (
            <div key={m.id} className={`chat-msg ${m.from === side ? "mine" : "theirs"}`}>
              <div className="chat-bubble">{m.body}</div>
              <div className="chat-meta">
                {m.from === "staff" ? `${m.name} · NVBC staff` : m.name} · {when(m.at)}
                {m.from === side && m.read ? " · Seen" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      <form className="chat-form" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          aria-label="Message"
          rows={2}
          maxLength={1000}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send"}</button>
      </form>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}
