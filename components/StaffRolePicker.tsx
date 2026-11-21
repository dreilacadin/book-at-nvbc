"use client";

import { ROLE_HINT, ROLE_LABEL, SCHOLAR_DESK_HINT, SCHOLAR_STRINGER_HINT, type StaffRole } from "@/lib/staff";

/**
 * Choose a role: Manager, Staff, Scholar or Stringer (the ones in `roles`). Only a Scholar can also
 * be a stringer, so the "also strings rackets" box shows only for Scholars.
 */
export default function StaffRolePicker({
  roles,
  role,
  stringer,
  onChange,
  hints = ROLE_HINT,
  stringerLabel = "Also strings rackets",
  stringerHint = SCHOLAR_STRINGER_HINT,
  deskHint = SCHOLAR_DESK_HINT,
  disabled = false,
}: {
  roles: readonly StaffRole[];
  role: StaffRole | "";
  stringer: boolean;
  onChange: (role: StaffRole, stringer: boolean) => void;
  hints?: Partial<Record<StaffRole, string>>;
  stringerLabel?: string;
  stringerHint?: string;
  /** For a Scholar who doesn't string. */
  deskHint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="staff-role-picker">
      <div className="segmented staff-roles" role="radiogroup" aria-label="Role" style={{ gridTemplateColumns: `repeat(${roles.length}, 1fr)` }}>
        {roles.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={role === r} disabled={disabled}
            onClick={() => onChange(r, r === "scholar" && stringer)}>
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      {role === "scholar" && (
        <label className="check-row">
          <input type="checkbox" checked={stringer} disabled={disabled} onChange={(e) => onChange("scholar", e.target.checked)} />
          <span>{stringerLabel}</span>
        </label>
      )}
      {role && hints[role] && (
        <p className="hint">
          {hints[role]}
          {role === "scholar" && (stringer ? stringerHint : deskHint) ? ` ${stringer ? stringerHint : deskHint}` : ""}
        </p>
      )}
    </div>
  );
}
