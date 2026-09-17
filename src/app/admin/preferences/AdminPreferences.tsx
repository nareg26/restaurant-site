"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  SHARED,
  dayLabel,
  rangeLabel,
  slotDur,
  slotLabel,
  slotsStore,
  type PrefSlot,
} from "@/lib/prefs-slots";
import { store as prefsStore } from "@/lib/prefs-store";
import { addDays, fromISODate, mondayOf, parseTime, toISODate } from "@/lib/time";
import styles from "./admin.module.css";

type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };

export default function AdminPreferences() {
  const [slots, setSlots] = useState<PrefSlot[] | null>(null);
  const [responseCount, setResponseCount] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "", msg: "" });
  const [moveStatus, setMoveStatus] = useState<Status>({ kind: "", msg: "" });

  /* the week being set up — drives which dates the day picker offers */
  const [weekStart, setWeekStart] = useState<string>("");
  const [day, setDay] = useState("");
  const [start, setStart] = useState("14:00");
  const [end, setEnd] = useState("17:00");
  const [need, setNeed] = useState("1");
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [list, count] = await Promise.all([slotsStore.list(), prefsStore.count()]);
      setSlots(list);
      setResponseCount(count);
    } catch (e) {
      console.error(e);
      setSlots([]);
      setStatus({ kind: "err", msg: "Couldn’t load — check the Supabase setup in the README." });
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect --
     The default week has to come from the viewer's clock. This page is
     prerendered, so a lazy useState initialiser would bake in the build date
     and the form would suggest a stale week forever. */
  useEffect(() => {
    // default to next week, which is what you're normally setting up
    const iso = toISODate(addDays(mondayOf(new Date()), 7));
    setWeekStart(iso);
    setDay(iso);
    refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const weekDays = weekStart
    ? Array.from({ length: 7 }, (_, i) => toISODate(addDays(new Date(weekStart + "T00:00:00"), i)))
    : [];

  const startMin = parseTime(start);
  const endMin = parseTime(end);
  const needNum = Number(need);
  const validTimes = endMin > startMin;
  const validNeed = Number.isInteger(needNum) && needNum >= 1 && needNum <= 20;
  const canAdd = Boolean(day) && validTimes && validNeed;

  const addSlot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    setStatus({ kind: "busy", msg: "Adding…" });
    try {
      await slotsStore.create({
        day,
        start_min: startMin,
        end_min: endMin,
        need: needNum,
        note: note.trim(),
      });
      setNote("");
      await refresh();
      setStatus({ kind: "ok", msg: "Shift added." });
    } catch (err) {
      console.error(err);
      setStatus({ kind: "err", msg: "Couldn’t add that shift." });
    }
  };

  const removeSlot = async (slot: PrefSlot) => {
    if (!confirm(`Remove ${dayLabel(slot.day)} ${slotLabel(slot)}?`)) return;
    try {
      await slotsStore.remove(slot.id);
      await refresh();
      setStatus({ kind: "ok", msg: "Shift removed." });
    } catch (err) {
      console.error(err);
      setStatus({ kind: "err", msg: "Couldn’t remove that shift." });
    }
  };

  const clearResponses = async () => {
    const n = responseCount ?? 0;
    if (n === 0) {
      setStatus({ kind: "", msg: "There are no responses to clear." });
      return;
    }
    if (
      !confirm(
        `Delete all ${n} staff response${n === 1 ? "" : "s"}?\n\n` +
          `This cannot be undone — the answers are not archived anywhere.`
      )
    )
      return;
    setStatus({ kind: "busy", msg: "Clearing…" });
    try {
      await prefsStore.clearAll();
      await refresh();
      setStatus({ kind: "ok", msg: "All responses deleted." });
    } catch (err) {
      console.error(err);
      setStatus({ kind: "err", msg: "Couldn’t clear responses." });
    }
  };

  const clearSlots = async () => {
    const n = slots?.length ?? 0;
    if (n === 0) {
      setStatus({ kind: "", msg: "There are no shifts to clear." });
      return;
    }
    if (!confirm(`Remove all ${n} shift${n === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setStatus({ kind: "busy", msg: "Clearing…" });
    try {
      await slotsStore.clear();
      await refresh();
      setStatus({ kind: "ok", msg: "All shifts removed." });
    } catch (err) {
      console.error(err);
      setStatus({ kind: "err", msg: "Couldn’t clear shifts." });
    }
  };

  const list = slots ?? [];
  const days = [...new Set(list.map((s) => s.day))].sort();

  /* Moving the round: whole weeks from the round's first Monday to the
     "Week starting" week. Round, because a clock change makes a week 167h. */
  const moveBy =
    weekStart && days.length
      ? Math.round(
          (mondayOf(fromISODate(weekStart)).getTime() - mondayOf(fromISODate(days[0])).getTime()) /
            86_400_000
        )
      : 0;
  const targetLabel = weekStart
    ? mondayOf(fromISODate(weekStart)).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
      })
    : "";
  const hasResponses = (responseCount ?? 1) > 0;

  const moveSlots = async () => {
    if (!moveBy || hasResponses) return;
    const n = list.length;
    if (!confirm(`Move all ${n} shift${n === 1 ? "" : "s"} to the week of ${targetLabel}?`)) return;
    setMoveStatus({ kind: "busy", msg: "Moving…" });
    try {
      await slotsStore.move(list, moveBy);
      await refresh();
      setMoveStatus({ kind: "ok", msg: `Moved to the week of ${targetLabel}.` });
    } catch (err) {
      console.error(err);
      await refresh();
      setMoveStatus({ kind: "err", msg: "Couldn’t move the shifts — check the list above." });
    }
  };
  const totalPeopleHours = list.reduce(
    (sum, s) => sum + ((s.end_min - s.start_min) / 60) * s.need,
    0
  );

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1>Set up the week</h1>
          <p>
            Add the shifts staff will choose from, then send them to{" "}
            <a href="/staff/preferences">/staff/preferences</a>. Clearing is permanent — nothing
            is archived.
          </p>
        </header>

        {!SHARED && (
          <div className={styles.banner}>
            <b>Not connected to Supabase.</b> Anything you add here is saved only in this
            browser.
          </div>
        )}

        <section className={styles.card}>
          <h2>Add a shift</h2>
          <form onSubmit={addSlot}>
            <div className={styles.weekRow}>
              <label className={styles.field}>
                Week starting
                <input
                  type="date"
                  value={weekStart}
                  onChange={(e) => {
                    if (!e.target.value) return;
                    setWeekStart(e.target.value);
                    setDay(e.target.value);
                  }}
                />
              </label>
              <span className={styles.hint}>
                Sets which days the dropdown offers. Shifts can span more than one week if you
                change it.
              </span>
            </div>

            <div className={styles.addRow}>
              <label className={styles.field}>
                Day
                <select value={day} onChange={(e) => setDay(e.target.value)}>
                  {weekDays.map((d) => (
                    <option key={d} value={d}>
                      {dayLabel(d)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                Start
                <input
                  type="time"
                  step={900}
                  value={start}
                  onChange={(e) => e.target.value && setStart(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                End
                <input
                  type="time"
                  step={900}
                  value={end}
                  onChange={(e) => e.target.value && setEnd(e.target.value)}
                />
              </label>
              <label className={styles.field}>
                People needed
                <input
                  type="text"
                  inputMode="numeric"
                  value={need}
                  onChange={(e) => setNeed(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                />
              </label>
            </div>

            <label className={styles.field}>
              Note (optional)
              <input
                type="text"
                placeholder="e.g. overlaps 14–17h"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            {!validTimes && <p className={styles.warn}>The end time must be after the start.</p>}
            {!validNeed && <p className={styles.warn}>People needed must be between 1 and 20.</p>}

            <div className={styles.actions}>
              <button type="submit" className={styles.primary} disabled={!canAdd}>
                Add shift
              </button>
              <span className={styles.status} data-kind={status.kind}>
                {status.msg}
              </span>
            </div>
          </form>
        </section>

        <section className={styles.card}>
          <h2>
            This round&rsquo;s shifts
            {list.length > 0 && <span className={styles.count}>{rangeLabel(list)}</span>}
          </h2>

          {slots === null && <p className={styles.muted}>Loading…</p>}
          {slots !== null && list.length === 0 && (
            <p className={styles.muted}>
              No shifts yet. Add some above and they&rsquo;ll appear on the staff page.
            </p>
          )}

          {days.map((d) => (
            <div key={d} className={styles.dayGroup}>
              <h3>{dayLabel(d)}</h3>
              {list
                .filter((s) => s.day === d)
                .map((s) => (
                  <div key={s.id} className={styles.slotRow}>
                    <span className={styles.slotTime}>
                      {slotLabel(s)} <span className={styles.dur}>({slotDur(s)})</span>
                    </span>
                    <span className={styles.slotNeed}>
                      {s.need} {s.need === 1 ? "person" : "people"}
                    </span>
                    <span className={styles.slotNote}>{s.note}</span>
                    <button
                      type="button"
                      className={styles.remove}
                      onClick={() => removeSlot(s)}
                      aria-label={`Remove ${dayLabel(s.day)} ${slotLabel(s)}`}
                    >
                      Remove
                    </button>
                  </div>
                ))}
            </div>
          ))}

          {list.length > 0 && (
            <p className={styles.muted}>
              {list.length} shift{list.length === 1 ? "" : "s"} · {totalPeopleHours}{" "}
              person-hours to cover
            </p>
          )}

          {list.length > 0 && (
            <div className={styles.actions}>
              <button
                type="button"
                onClick={moveSlots}
                disabled={!moveBy || hasResponses}
              >
                Move to week of {targetLabel}
              </button>
              <span className={styles.status} data-kind={moveStatus.kind}>
                {moveStatus.msg ||
                  (hasResponses
                    ? "Clear responses first — answers would stick to the moved shifts."
                    : !moveBy
                      ? "Already in that week. Change “Week starting” above to pick another."
                      : "")}
              </span>
            </div>
          )}
        </section>

        <section className={`${styles.card} ${styles.danger}`}>
          <h2>Start a new week</h2>
          <p className={styles.muted}>
            {responseCount === null
              ? "Checking responses…"
              : `${responseCount} staff response${responseCount === 1 ? "" : "s"} stored.`}{" "}
            Deleting is permanent — take a copy of anything you want to keep first.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.dangerBtn} onClick={clearResponses}>
              Clear responses
            </button>
            <button type="button" className={styles.dangerBtn} onClick={clearSlots}>
              Clear shifts
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
