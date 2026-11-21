"use client";

import { useState, type ComponentProps } from "react";

/**
 * A password box with a Show/Hide button, so people can check what they typed (handy on phones).
 * Takes the same props as an <input>, except `type`.
 */
export default function PasswordInput({ className, style, ref, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`pw-field${className ? ` ${className}` : ""}`} style={style}>
      <input {...props} ref={ref} type={shown ? "text" : "password"} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="pw-toggle" aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
        title={shown ? "Hide password" : "Show password"} onClick={() => setShown((v) => !v)}>
        {shown ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
            <path d="M9.4 5.2A9.9 9.9 0 0 1 12 5c5 0 9 4.5 10 7a12.4 12.4 0 0 1-3.1 4.2M6.3 6.3C4.2 7.7 2.7 9.8 2 12c1 2.5 5 7 10 7a9.7 9.7 0 0 0 5.7-1.7" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </span>
  );
}
