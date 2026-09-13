"use client";

import React, { useEffect, useState } from "react";
import {
  ALL_DAYS,
  DAY_LETTERS,
  DAY_LONG,
  nthWeekday,
  presetLabel,
  presetOf,
  presetRule,
  summary,
  usesLast,
  type Freq,
  type PresetKey,
  type RepeatRule,
} from "@/lib/tasks-repeat";
import { addDays, fromISODate, toISODate } from "@/lib/time";
import styles from "./tasks.module.css";

const PRESETS: PresetKey[] = ["none", "daily", "weekday", "weekly", "monthly", "custom"];
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth"];

type Props = {
  value: RepeatRule | null;
  /** Anchor for a brand-new rule (normally today). */
  defaultStart: string;
  onDone: (rule: RepeatRule | null) => void;
  onCancel: () => void;
};

/** Google-Calendar-style recurrence editor, plus a start date (templates have none). */
export default function RepeatDialog({ value, defaultStart, onDone, onCancel }: Props) {
  const [start, setStart] = useState(value?.start ?? defaultStart);
  const [preset, setPreset] = useState<PresetKey>(presetOf(value));
  const [freq, setFreq] = useState<Freq>(value?.freq ?? "weekly");
  const [interval, setInterval_] = useState(String(value?.interval ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(
    value?.weekdays ?? [fromISODate(defaultStart).getDay()]
  );
  const [monthly, setMonthly] = useState<"day" | "weekday">(value?.monthly ?? "day");
  const [endKind, setEndKind] = useState<"never" | "on" | "after">(value?.end.kind ?? "never");
  const [endDate, setEndDate] = useState(
    value?.end.kind === "on" ? value.end.date : toISODate(addDays(fromISODate(defaultStart), 90))
  );
  const [endCount, setEndCount] = useState(String(value?.end.kind === "after" ? value.end.count : 12));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const s = fromISODate(start);

  const customRule = (): RepeatRule => ({
    freq,
    interval: Math.max(1, Math.floor(Number(interval) || 1)),
    start,
    weekdays: freq === "weekly" ? (weekdays.length ? weekdays : [s.getDay()]) : ALL_DAYS,
    monthly,
    end:
      endKind === "on"
        ? { kind: "on", date: endDate || start }
        : endKind === "after"
          ? { kind: "after", count: Math.max(1, Math.floor(Number(endCount) || 1)) }
          : { kind: "never" },
  });

  const rule: RepeatRule | null = preset === "custom" ? customRule() : presetRule(preset, start);

  const choosePreset = (key: PresetKey) => {
    setPreset(key);
    if (key === "custom") {
      // Seed the custom fields from whatever preset was showing.
      const from = presetRule(preset, start);
      if (from) {
        setFreq(from.freq);
        setWeekdays(from.weekdays);
        setMonthly(from.monthly);
      }
    }
  };

  const toggleDay = (d: number) =>
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d].sort()));

  const unitLabel = (f: Freq) =>
    ({ daily: "day", weekly: "week", monthly: "month", yearly: "year" })[f];

  return (
    <div className={styles.modalBack} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={styles.modal} role="dialog" aria-label="Repeat">
        <h3 className={styles.modalTitle}>Repeat</h3>

        <label className={styles.mRow}>
          <span>Starting</span>
          <input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>

        <label className={styles.mRow}>
          <span>Repeats</span>
          <select value={preset} onChange={(e) => choosePreset(e.target.value as PresetKey)}>
            {PRESETS.map((k) => (
              <option key={k} value={k}>
                {presetLabel(k, start)}
              </option>
            ))}
          </select>
        </label>

        {preset === "custom" && (
          <div className={styles.custom}>
            <div className={styles.mRow}>
              <span>Repeat every</span>
              <span className={styles.mInline}>
                <input
                  type="number"
                  min={1}
                  max={99}
                  inputMode="numeric"
                  className={styles.mNum}
                  value={interval}
                  onChange={(e) => setInterval_(e.target.value)}
                  aria-label="Interval"
                />
                <select
                  value={freq}
                  onChange={(e) => {
                    const f = e.target.value as Freq;
                    setFreq(f);
                    // Switching to weeks starts from the start date's weekday, like Google.
                    if (f === "weekly" && (weekdays.length === 0 || weekdays.length === 7))
                      setWeekdays([s.getDay()]);
                  }}
                  aria-label="Unit"
                >
                  {(["daily", "weekly", "monthly", "yearly"] as Freq[]).map((f) => (
                    <option key={f} value={f}>
                      {unitLabel(f)}
                      {Number(interval) > 1 ? "s" : ""}
                    </option>
                  ))}
                </select>
              </span>
            </div>

            {freq === "weekly" && (
              <div className={styles.mRow}>
                <span>Repeat on</span>
                <span className={styles.dayCircles}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                    <button
                      type="button"
                      key={d}
                      className={`${styles.dayCircle} ${weekdays.includes(d) ? styles.dayOn : ""}`}
                      aria-pressed={weekdays.includes(d)}
                      aria-label={DAY_LONG[d]}
                      onClick={() => toggleDay(d)}
                    >
                      {DAY_LETTERS[d]}
                    </button>
                  ))}
                </span>
              </div>
            )}

            {freq === "monthly" && (
              <div className={styles.mRow}>
                <span />
                <select
                  value={monthly}
                  onChange={(e) => setMonthly(e.target.value as "day" | "weekday")}
                  aria-label="Monthly on"
                >
                  <option value="day">Monthly on day {s.getDate()}</option>
                  <option value="weekday">
                    Monthly on the {usesLast(s) ? "last" : ORDINAL[nthWeekday(s)]} {DAY_LONG[s.getDay()]}
                  </option>
                </select>
              </div>
            )}

            <div className={styles.mRow}>
              <span>Ends</span>
              <div className={styles.ends}>
                <label className={styles.radio}>
                  <input type="radio" checked={endKind === "never"} onChange={() => setEndKind("never")} />
                  Never
                </label>
                <label className={styles.radio}>
                  <input type="radio" checked={endKind === "on"} onChange={() => setEndKind("on")} />
                  On
                  <input
                    type="date"
                    value={endDate}
                    disabled={endKind !== "on"}
                    onChange={(e) => e.target.value && setEndDate(e.target.value)}
                    aria-label="End date"
                  />
                </label>
                <label className={styles.radio}>
                  <input type="radio" checked={endKind === "after"} onChange={() => setEndKind("after")} />
                  After
                  <input
                    type="number"
                    min={1}
                    max={999}
                    inputMode="numeric"
                    className={styles.mNum}
                    value={endCount}
                    disabled={endKind !== "after"}
                    onChange={(e) => setEndCount(e.target.value)}
                    aria-label="Number of occurrences"
                  />
                  occurrences
                </label>
              </div>
            </div>
          </div>
        )}

        <p className={styles.summaryLine}>
          {rule ? `↻ ${summary(rule)}` : "Does not repeat"}
          {rule && (
            <span className={styles.muted}>
              {" "}
              · from {s.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
            </span>
          )}
        </p>

        <div className={styles.modalActions}>
          <button type="button" className={styles.popItemSmall} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.popGo} onClick={() => onDone(rule)}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
