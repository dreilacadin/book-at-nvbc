"use client";

import { useId, useState } from "react";
import { suggestClients, type KnownClient } from "@/lib/coach";

/**
 * A coach's Client box, with suggestions from their own clients as they type, so the same person
 * isn't entered twice under different spellings ("Mike Santos" → "Michael Santos"). The list sits
 * under the box (not floating), so it's never cut off inside a dialog.
 */
export default function ClientInput({
  id,
  value,
  onChange,
  clients,
  placeholder = "e.g. Ana Cruz",
  autoFocus,
  label,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  clients: KnownClient[];
  placeholder?: string;
  autoFocus?: boolean;
  label?: string; // aria-label, when there's no <label for=…>
}) {
  const listId = useId();
  const [open, setOpen] = useState(!!autoFocus);
  const [active, setActive] = useState(-1);
  const list = open ? suggestClients(value, clients) : [];
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div className="client-input">
      <input
        id={id}
        type="text"
        maxLength={60}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={list.length > 0}
        aria-controls={listId}
        aria-activedescendant={active >= 0 && list[active] ? `${listId}-${active}` : undefined}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!list.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % list.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? list.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault(); // pick it, don't submit the form
            pick(list[active].name);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {list.length > 0 && (
        <div className="client-suggest">
          <div className="hint">{value.trim() ? "Same person? Pick them so their sessions stay together:" : "Your clients:"}</div>
          <ul id={listId} role="listbox">
            {list.map((c, i) => (
              <li
                key={c.name}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} // keep the focus in the box
                onClick={() => pick(c.name)}
              >
                <span>{c.name}</span>
                <small>{c.sessions} session{c.sessions === 1 ? "" : "s"}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
