"use client";

// In-page replacements for window.alert / confirm / prompt: the same one-line calls, but they open
// one of our own pop-ups (styled like the rest of the site, a bottom sheet on phones) and return a
// promise:
//   if (!(await confirmDialog("Cancel #127?", { confirmLabel: "Cancel racket", danger: true }))) return;
//   const note = await promptDialog("Why?", { required: true });   // null when they cancel
//   await alertDialog("Saved.");
// <DialogHost /> (in the root layout) shows them, one at a time, above any other pop-up.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import PasswordInput from "./PasswordInput";

type Common = {
  /** Bold heading above the message. */
  title?: string;
  /** Text of the main button ("OK" for alerts and prompts, "Yes" for confirms by default). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red main button: for deleting, cancelling and other things that are hard to undo. */
  danger?: boolean;
};
export type PromptOptions = Common & {
  defaultValue?: string;
  placeholder?: string;
  /** The main button stays off until something is typed. */
  required?: boolean;
  /** The main button stays off until exactly this is typed (e.g. "DELETE"). */
  match?: string;
  multiline?: boolean;
  maxLength?: number;
  /** Shows the text selected, for copying by hand (when the clipboard isn't available). */
  readOnly?: boolean;
  password?: boolean;
};

type Request =
  | ({ kind: "alert"; message: string; resolve: (v: undefined) => void } & Common)
  | ({ kind: "confirm"; message: string; resolve: (v: boolean) => void } & Common)
  | ({ kind: "prompt"; message: string; resolve: (v: string | null) => void } & PromptOptions);

let queue: (Request & { id: number })[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const push = (r: Request) => {
  queue = [...queue, { ...r, id: nextId++ }];
  emit();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const alertDialog = (message: string, opts: Common = {}) =>
  new Promise<void>((resolve) => push({ kind: "alert", message, ...opts, resolve: () => resolve() }));
export const confirmDialog = (message: string, opts: Common = {}) =>
  new Promise<boolean>((resolve) => push({ kind: "confirm", message, ...opts, resolve }));
export const promptDialog = (message: string, opts: PromptOptions = {}) =>
  new Promise<string | null>((resolve) => push({ kind: "prompt", message, ...opts, resolve }));
/** The text, selected, with a note to copy it (for when the clipboard can't be used). */
export const copyDialog = (message: string, text: string) =>
  promptDialog(message, { defaultValue: text, readOnly: true, multiline: text.length > 60 || text.includes("\n"), confirmLabel: "Done" }).then(() => undefined);

export default function DialogHost() {
  const current = useSyncExternalStore(subscribe, () => queue[0] ?? null, () => null);
  return current ? <Dialog key={current.id} req={current} /> : null;
}

function close(req: Request, value: unknown) {
  queue = queue.filter((r) => r !== req);
  emit();
  (req.resolve as (v: unknown) => void)(value);
}

function Dialog({ req }: { req: Request }) {
  const [text, setText] = useState(req.kind === "prompt" ? req.defaultValue ?? "" : "");
  const mainRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const cancelValue = req.kind === "confirm" ? false : req.kind === "prompt" ? null : undefined;
  const cancel = () => close(req, cancelValue);
  const ok = () => close(req, req.kind === "confirm" ? true : req.kind === "prompt" ? text : undefined);
  const blocked = req.kind === "prompt" && !req.readOnly && ((req.required && !text.trim()) || (req.match !== undefined && text.trim() !== req.match));

  // Focus the box (or the main button), put focus back where it was afterwards, and Esc cancels.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const el = inputRef.current ?? mainRef.current;
    el?.focus();
    if (req.kind === "prompt" && req.readOnly) inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation(); // only this pop-up closes, not one underneath
        cancel();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per dialog
  }, []);

  const label = req.confirmLabel ?? (req.kind === "confirm" ? "Yes" : "OK");
  return (
    <div className="backdrop dialog-backdrop" onClick={req.kind === "alert" ? ok : cancel}>
      <form
        className="card modal dialog-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={req.title ? "dialog-title" : "dialog-message"}
        aria-describedby={req.title ? "dialog-message" : undefined}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!blocked) ok();
        }}
      >
        {req.title && <h2 id="dialog-title">{req.title}</h2>}
        <p id="dialog-message" className="dialog-message">{req.message}</p>
        {req.kind === "prompt" &&
          (req.multiline ? (
            <textarea ref={inputRef} rows={req.readOnly ? 6 : 3} value={text} placeholder={req.placeholder} maxLength={req.maxLength}
              readOnly={req.readOnly} aria-labelledby="dialog-message" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !blocked) ok();
              }} />
          ) : req.password ? (
            <PasswordInput ref={inputRef} value={text} placeholder={req.placeholder} maxLength={req.maxLength}
              aria-labelledby="dialog-message" autoComplete="new-password" onChange={(e) => setText(e.target.value)} />
          ) : (
            <input ref={inputRef} value={text} placeholder={req.placeholder} maxLength={req.maxLength} readOnly={req.readOnly}
              aria-labelledby="dialog-message" type="text" autoComplete="off" onChange={(e) => setText(e.target.value)} />
          ))}
        <div className="actions dialog-actions">
          {req.kind !== "alert" && !(req.kind === "prompt" && req.readOnly) && (
            <button type="button" className="btn secondary" onClick={cancel}>{req.cancelLabel ?? "Cancel"}</button>
          )}
          <button ref={mainRef} type="submit" className={`btn${req.danger ? " danger" : ""}`} disabled={blocked}>{label}</button>
        </div>
      </form>
    </div>
  );
}
