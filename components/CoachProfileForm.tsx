"use client";

import {
  DAY_NAMES,
  GENDERS,
  type AvailabilitySlot,
  type Gender,
} from "@/lib/coach";
import { formatHour } from "@/lib/format";
import { imageToDataUrl } from "@/lib/image";
import { allActivities } from "@/lib/sports";
import { useEffect, useState } from "react";
import PhotoCropper from "./PhotoCropper";

export type CoachFormValues = {
  fullName: string;
  nickname: string;
  gender: Gender | "";
  genderSelf: string;
  birthday: string; // YYYY-MM-DD
  email: string;
  mobile: string;
  phpaId: string;
  sports: string[];
  rates: string;
  availability: AvailabilitySlot[];
  credentials: string;
  bio: string;
  photo?: string; // a new profile photo (data URL)
  phpaPhoto?: string; // a new ID photo ("" removes it)
};

const TIMES = Array.from({ length: 49 }, (_, i) => i / 2);
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** Which days and times the coach is available: per day, one or more ranges. */
export function AvailabilityEditor({
  value,
  onChange,
}: {
  value: AvailabilitySlot[];
  onChange: (v: AvailabilitySlot[]) => void;
}) {
  const update = (i: number, patch: Partial<AvailabilitySlot>) =>
    onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="avail">
      {ORDER.map((day) => {
        const ranges = value
          .map((s, i) => ({ s, i }))
          .filter((x) => x.s.day === day);
        return (
          <div key={day} className="avail-day">
            <label className="avail-toggle">
              <input
                type="checkbox"
                checked={ranges.length > 0}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, { day, from: 8, to: 17 }]
                      : value.filter((s) => s.day !== day),
                  )
                }
              />
              {DAY_NAMES[day]}
            </label>
            <div className="avail-ranges">
              {ranges.map(({ s, i }) => (
                <span key={i} className="avail-range">
                  <select
                    aria-label={`${DAY_NAMES[day]} from`}
                    value={s.from}
                    onChange={(e) =>
                      update(i, { from: Number(e.target.value) })
                    }
                  >
                    {TIMES.slice(0, -1).map((t) => (
                      <option key={t} value={t}>
                        {formatHour(t)}
                      </option>
                    ))}
                  </select>
                  <span>to</span>
                  <select
                    aria-label={`${DAY_NAMES[day]} to`}
                    value={s.to}
                    onChange={(e) => update(i, { to: Number(e.target.value) })}
                  >
                    {TIMES.slice(1).map((t) => (
                      <option key={t} value={t}>
                        {formatHour(t)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="link-btn"
                    aria-label="Remove these hours"
                    onClick={() => onChange(value.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {ranges.length > 0 && (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() =>
                    onChange([...value, { day, from: 18, to: 21 }])
                  }
                >
                  + more hours
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A photo picker that shrinks the picture before it's sent. */
function PhotoField({
  label,
  hint,
  current,
  value,
  onChange,
  optional,
  crop,
}: {
  label: string;
  hint?: string;
  current?: string | null;
  value?: string;
  onChange: (v: string) => void;
  optional?: boolean;
  crop?: boolean; // square-crop the photo after choosing it
}) {
  const [error, setError] = useState("");
  const [original, setOriginal] = useState<string | null>(null); // the chosen file, to crop (again)
  const [cropping, setCropping] = useState<string | null>(null);
  useEffect(() => () => { if (original) URL.revokeObjectURL(original); }, [original]);
  const shown = value === undefined ? current : value;
  return (
    <div className="field">
      <label>
        {label} {optional && <span className="hint">(optional)</span>}
      </label>
      {hint && (
        <p className="hint" style={{ margin: "0 0 6px" }}>
          {hint}
        </p>
      )}
      <div className="photo-field">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" />
        ) : (
          <span className="photo-empty">No photo</span>
        )}
        <label className="btn small secondary">
          {shown ? "Change" : "Choose photo"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (crop) {
                if (!f.type.startsWith("image/")) return setError("That file isn't an image.");
                const url = URL.createObjectURL(f);
                setOriginal(url);
                setCropping(url);
                setError("");
                return;
              }
              try {
                onChange(
                  await imageToDataUrl(
                    f,
                    700,
                    "That photo is too large. Please choose a smaller one.",
                  ),
                );
                setError("");
              } catch (err) {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Couldn't read that photo.",
                );
              }
            }}
          />
        </label>
        {crop && shown && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setCropping(original ?? shown)}
          >
            Crop
          </button>
        )}
        {optional && shown && (
          <button
            type="button"
            className="link-btn"
            onClick={() => onChange("")}
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <div className="error" style={{ marginTop: 6 }}>
          {error}
        </div>
      )}
      {cropping && (
        <PhotoCropper
          src={cropping}
          onCancel={() => setCropping(null)}
          onDone={(v) => {
            onChange(v);
            setCropping(null);
          }}
        />
      )}
    </div>
  );
}

/** The coach's details: used for signing up and for editing the profile later. */
export default function CoachProfileForm({
  photoUrl,
  idPhotoUrl,
  values,
  onChange,
}: {
  photoUrl?: string | null; // the saved photos (when editing)
  idPhotoUrl?: string | null;
  values: CoachFormValues;
  onChange: (v: CoachFormValues) => void;
}) {
  const set = <K extends keyof CoachFormValues>(k: K, v: CoachFormValues[K]) =>
    onChange({ ...values, [k]: v });
  return (
    <div className="stack coach-form">
      <div className="row">
        <div className="field">
          <label htmlFor="cf-name">
            Full legal name{" "}
            <span className="hint">— for NVBC&apos;s records</span>
          </label>
          <input
            id="cf-name"
            required
            maxLength={80}
            autoComplete="name"
            value={values.fullName}
            onChange={(e) => set("fullName", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="cf-mobile">Mobile number</label>
          <input
            id="cf-mobile"
            type="tel"
            required
            maxLength={30}
            autoComplete="tel"
            placeholder="09XX XXX XXXX"
            value={values.mobile}
            onChange={(e) => set("mobile", e.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="cf-nick">
            Nickname <span className="hint">— the name shown on bookings</span>
          </label>
          <input
            id="cf-nick"
            required
            maxLength={40}
            placeholder="e.g. Coach Drei"
            value={values.nickname}
            onChange={(e) => set("nickname", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="cf-bday">
            Birthday{" "}
            <span className="hint">— so we can greet you on the day</span>
          </label>
          <input
            id="cf-bday"
            type="date"
            required
            autoComplete="bday"
            value={values.birthday}
            onChange={(e) => set("birthday", e.target.value)}
          />
        </div>
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="cf-gender">Gender</label>
          <select
            id="cf-gender"
            required
            value={values.gender}
            onChange={(e) => set("gender", e.target.value as Gender | "")}
          >
            <option value="" disabled>
              Choose…
            </option>
            {GENDERS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
        {values.gender === "self_describe" ? (
          <div>
            <label htmlFor="cf-gender-self">Your gender</label>
            <input
              id="cf-gender-self"
              required
              maxLength={40}
              value={values.genderSelf}
              onChange={(e) => set("genderSelf", e.target.value)}
            />
          </div>
        ) : (
          <div className="field" aria-hidden />
        )}
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="cf-email">
            Email <span className="hint">— you&apos;ll log in with it</span>
          </label>
          <input
            id="cf-email"
            type="email"
            required
            maxLength={120}
            autoComplete="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="cf-phpa">
            PHPA ID number <span className="hint">(if you have one)</span>
          </label>
          <input
            id="cf-phpa"
            maxLength={40}
            value={values.phpaId}
            onChange={(e) => set("phpaId", e.target.value)}
          />
        </div>
      </div>
      <PhotoField
        label="Profile photo"
        hint="A clear photo of your face — customers see it when choosing a coach. You can add it later."
        optional
        crop
        current={photoUrl}
        value={values.photo}
        onChange={(v) => set("photo", v)}
      />
      <PhotoField
        label="PHPA ID photo"
        hint="Only NVBC staff see this."
        optional
        current={idPhotoUrl}
        value={values.phpaPhoto}
        onChange={(v) => set("phpaPhoto", v)}
      />
      <div className="field">
        <label>What do you coach?</label>
        <div className="court-checks">
          {allActivities().map((a) => (
            <label key={a.id}>
              <input
                type="checkbox"
                checked={values.sports.includes(a.id)}
                onChange={(e) =>
                  set(
                    "sports",
                    e.target.checked
                      ? [...values.sports, a.id]
                      : values.sports.filter((x) => x !== a.id),
                  )
                }
              />
              {a.emoji} {a.label}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="cf-rates">Your coaching rates</label>
        <textarea
          id="cf-rates"
          required
          maxLength={1000}
          rows={4}
          value={values.rates}
          onChange={(e) => set("rates", e.target.value)}
          placeholder={
            "e.g.\n₱500 per hour (1-on-1)\n₱300 per person per hour for groups of 3+\n₱2,000 for a 5-session package"
          }
        />
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Customers see this when asking for a coaching session, and pay you
          directly.
        </p>
      </div>
      <div className="field">
        <label htmlFor="cf-creds">
          Credentials &amp; achievements{" "}
          <span className="hint">(optional)</span>
        </label>
        <textarea
          id="cf-creds"
          maxLength={1500}
          rows={4}
          value={values.credentials}
          onChange={(e) => set("credentials", e.target.value)}
          placeholder={
            "e.g.\nPHPA Level 1 certified coach\nChampion, Metro Manila Open 2024 (Men's Doubles)\nFormer UAAP varsity player"
          }
        />
        <p className="hint" style={{ margin: "4px 0 0" }}>
          Certifications, tournament results, teams — customers see this.
        </p>
      </div>
      <div className="field">
        <label htmlFor="cf-bio">
          Bio <span className="hint">(optional)</span>
        </label>
        <textarea
          id="cf-bio"
          maxLength={1500}
          rows={4}
          value={values.bio}
          onChange={(e) => set("bio", e.target.value)}
          placeholder="A few lines about you and how you coach."
        />
      </div>
      <div className="field">
        <label>When are you available to coach?</label>
        <AvailabilityEditor
          value={values.availability}
          onChange={(v) => set("availability", v)}
        />
      </div>
    </div>
  );
}
