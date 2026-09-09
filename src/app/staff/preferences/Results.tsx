"use client";

import React from "react";
import { MARKS } from "@/lib/prefs-config";
import { dayShort, slotDur, slotLabel, type PrefSlot } from "@/lib/prefs-slots";
import type { PublicPrefRow } from "@/lib/prefs-store";
import styles from "./preferences.module.css";

const label = (slot: PrefSlot) =>
  `${dayShort(slot.day)} ${slotLabel(slot)} (${slotDur(slot)})`;

export default function Results({
  rows,
  slots,
  loadError,
}: {
  rows: PublicPrefRow[] | null;
  slots: PrefSlot[];
  loadError: boolean;
}) {
  if (loadError) return <p className={styles.who}>Couldn’t load responses — see the README’s Supabase setup.</p>;
  if (rows === null) return <p className={styles.who}>Loading responses…</p>;
  if (!rows.length)
    return (
      <p className={styles.empty}>
        No one has filled this in yet. Yours will show up here the moment you save.
      </p>
    );

  /* per-slot marks, and the slots that don't have enough people yet */
  const thin: string[] = [];
  const slotGroups = slots.map((slot) => {
    const groups: Record<string, string[]> = { want: [], fine: [], no: [], cant: [] };
    for (const r of rows) {
      const m = r.marks[slot.id];
      if (!m || !groups[m]) continue;
      const p = r.points[slot.id] || 0;
      groups[m].push(p ? `${r.name} (${p})` : r.name);
    }
    const available = groups.want.length + groups.fine.length;
    if (available < slot.need) thin.push(label(slot));
    return { slot, groups, available };
  });

  /* Total hours people are asking for, so it can be weighed against what the
     week actually needs. null when nobody answered the question. */
  const stated = rows.filter((r) => r.hours_per_week !== null);
  const totalHours = stated.length
    ? stated.reduce((sum, r) => sum + (r.hours_per_week ?? 0), 0)
    : null;

  return (
    <>
      <p className={styles.who}>Answers from {rows.map((r) => r.name).join(", ")}.</p>

      {thin.length > 0 && (
        <div className={styles.callout}>
          <h3>Nobody available yet for:</h3>
          <ul>
            {thin.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      <div>
        {slotGroups.map(({ slot, groups, available }) => (
          <div key={slot.id} className={styles.rslot}>
            <div className={styles.rslotHead}>
              <span className={styles.rslotTime}>{label(slot)}</span>
              <span className={`${styles.cover} ${available < slot.need ? styles.thin : ""}`}>
                {available} available · needs {slot.need}
              </span>
            </div>
            <div className={styles.names}>
              {MARKS.flatMap((m) =>
                groups[m.k].map((n) => (
                  <span key={`${m.k}-${n}`} className={`${styles.chip} ${styles[m.k]}`}>
                    {n}
                  </span>
                ))
              )}
              {MARKS.every((m) => groups[m.k].length === 0) && (
                <span className={styles.chip}>no answers yet</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.scroll}>
        <table>
          <thead>
            <tr>
              <th>Who</th>
              <th>Hours/week</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {/* Never render the ID here: it's the only credential someone
                    needs to open and overwrite that person's answers. */}
                <td>{r.name}</td>
                <td>{r.hours_per_week === null ? "—" : r.hours_per_week}</td>
                <td>{r.notes.trim() || "—"}</td>
              </tr>
            ))}
            {totalHours !== null && (
              <tr>
                <td>
                  <b>Total</b>
                </td>
                <td>
                  <b>{totalHours}</b>
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
