"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SHARED, store, type NewShift, type Shift } from "@/lib/shifts-store";
import { addDays, fmtMin, fromISODate, mondayOf, parseTime, toISODate } from "@/lib/time";
import styles from "./schedule.module.css";

const DAY_START = 7 * 60; // grid shows 7:00 …
const DAY_END = 22 * 60; // … to 22:00
const PX_PER_MIN = 0.8; // 48px per hour
const SNAP = 15; // drag snapping, minutes
const MIN_LEN = 30; // shortest shift, minutes

type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };
const DOT_CLASS = { "": "", ok: styles.dotOk, busy: styles.dotBusy, err: styles.dotErr };

type Draft = {
  day: string;
  startMin: number;
  endMin: number;
  emoji: string;
  title: string;
  person: string;
};

type Drag =
  | {
      kind: "create";
      day: string;
      anchorMin: number;
      startMin: number;
      endMin: number;
      moved: boolean;
      rect: DOMRect;
    }
  | { kind: "resize"; edge: "start" | "end"; shift: Shift; rect: DOMRect };

/** Greedy lane assignment: overlapping shifts get separate lanes. */
function layoutLanes(dayShifts: Shift[]) {
  const sorted = [...dayShifts].sort(
    (a, b) => a.start_min - b.start_min || a.end_min - b.end_min
  );
  const laneEnds: number[] = [];
  const laneOf = new Map<string, number>();
  for (const s of sorted) {
    let lane = laneEnds.findIndex((end) => end <= s.start_min);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = s.end_min;
    laneOf.set(s.id, lane);
  }
  return { laneOf, laneCount: Math.max(1, laneEnds.length) };
}

const minuteAt = (clientY: number, rect: DOMRect) => {
  const raw = DAY_START + (clientY - rect.top) / PX_PER_MIN;
  const snapped = Math.round(raw / SNAP) * SNAP;
  return Math.max(DAY_START, Math.min(DAY_END, snapped));
};

export default function Schedule() {
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "", msg: "Starting…" });
  const [banner, setBanner] = useState<React.ReactNode>(null);

  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<Draft | null>(null);
  draftRef.current = draft;
  const suppressClickUntil = useRef(0);

  const load = useCallback(async (ws: Date, quiet = false) => {
    if (dragRef.current || draftRef.current) return; // don't clobber mid-interaction
    try {
      const list = await store.list(toISODate(ws), toISODate(addDays(ws, 6)));
      if (!dragRef.current) setShifts(list);
      if (!quiet)
        setStatus({
          kind: "ok",
          msg: SHARED ? "Synced with your team" : "Saved in this browser only",
        });
      if (SHARED) setBanner(null); // keep the local-only notice visible in local mode
    } catch (e) {
      setStatus({ kind: "err", msg: "Can’t reach Supabase" });
      console.error(e);
      if (!quiet)
        setBanner(
          <>
            <b>Couldn’t load from Supabase.</b> Usually this means the <code>shifts</code>{" "}
            table doesn’t exist yet or its access policy is missing — the SQL to create it
            is in the README.
            <br />
            <small>{String(e instanceof Error ? e.message : e)}</small>
          </>
        );
    }
  }, []);

  useEffect(() => {
    const ws = mondayOf(new Date());
    setWeekStart(ws);
    if (!SHARED) {
      setStatus({ kind: "", msg: "Local only" });
      setBanner(
        <>
          <b>Not connected to Supabase yet.</b> Set the env vars in <code>.env.local</code>{" "}
          (see the README). Until then, shifts save only in your own browser.
        </>
      );
    }
  }, []);

  useEffect(() => {
    if (!weekStart) return;
    load(weekStart);
    if (!SHARED) return;
    const interval = setInterval(() => load(weekStart, true), 5000);
    const onVisible = () => {
      if (!document.hidden) load(weekStart, true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [weekStart, load]);

  /* ---------- mutations ---------- */

  const createShift = async (ns: NewShift) => {
    setStatus({ kind: "busy", msg: "Saving…" });
    try {
      const created = await store.create(ns);
      setShifts((prev) => [...prev, created]);
      setStatus({ kind: "ok", msg: SHARED ? "Saved · visible to the team" : "Saved in this browser" });
    } catch (e) {
      setStatus({ kind: "err", msg: "Save failed" });
      console.error(e);
    }
  };

  const saveTimes = async (id: string, patch: { start_min: number; end_min: number }) => {
    setStatus({ kind: "busy", msg: "Saving…" });
    try {
      await store.update(id, patch);
      setStatus({ kind: "ok", msg: SHARED ? "Saved · visible to the team" : "Saved in this browser" });
    } catch (e) {
      setStatus({ kind: "err", msg: "Save failed" });
      console.error(e);
    }
  };

  /* ---------- dragging (create + resize) ---------- */

  const onMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const m = minuteAt(e.clientY, d.rect);
    if (d.kind === "create") {
      let startMin = Math.min(d.anchorMin, m);
      let endMin = Math.max(d.anchorMin, m);
      if (endMin - startMin < SNAP) endMin = Math.min(DAY_END, startMin + SNAP);
      const next: Drag = { ...d, startMin, endMin, moved: d.moved || m !== d.anchorMin };
      dragRef.current = next;
      setDrag(next);
    } else {
      const s = d.shift;
      const updated: Shift =
        d.edge === "start"
          ? { ...s, start_min: Math.min(m, s.end_min - MIN_LEN) }
          : { ...s, end_min: Math.max(m, s.start_min + MIN_LEN) };
      const next: Drag = { ...d, shift: updated };
      dragRef.current = next;
      setDrag(next);
      setShifts((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
    }
  };

  const onUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    window.removeEventListener("pointermove", onMove);
    if (!d) return;
    if (d.kind === "create") {
      let { startMin, endMin } = d;
      if (!d.moved) {
        startMin = d.anchorMin;
        endMin = Math.min(DAY_END, startMin + 60);
      }
      if (endMin - startMin < MIN_LEN) endMin = Math.min(DAY_END, startMin + MIN_LEN);
      setDraft({ day: d.day, startMin, endMin, emoji: "🍽️", title: "", person: "" });
    } else {
      suppressClickUntil.current = Date.now() + 400;
      saveTimes(d.shift.id, { start_min: d.shift.start_min, end_min: d.shift.end_min });
    }
  };

  const beginDrag = (d: Drag) => {
    dragRef.current = d;
    setDrag(d);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>, day: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("a")) return; // clicks on cards are links
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const m = minuteAt(e.clientY, rect);
    beginDrag({
      kind: "create",
      day,
      anchorMin: m,
      startMin: m,
      endMin: Math.min(DAY_END, m + SNAP),
      moved: false,
      rect,
    });
  };

  const onHandlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    s: Shift,
    edge: "start" | "end"
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const body = (e.currentTarget as HTMLElement).closest("[data-daybody]");
    if (!body) return;
    beginDrag({ kind: "resize", edge, shift: s, rect: body.getBoundingClientRect() });
  };

  /* ---------- copy last week ---------- */

  const copyLastWeek = async () => {
    if (!weekStart) return;
    try {
      const prev = await store.list(
        toISODate(addDays(weekStart, -7)),
        toISODate(addDays(weekStart, -1))
      );
      if (!prev.length) {
        setStatus({ kind: "err", msg: "Last week has no shifts to copy" });
        return;
      }
      if (!confirm(`Copy ${prev.length} shift(s) from last week into this week?`)) return;
      setStatus({ kind: "busy", msg: "Copying…" });
      for (const s of prev) {
        const { id: _id, ...rest } = s;
        void _id;
        await store.create({ ...rest, day: toISODate(addDays(fromISODate(s.day), 7)) });
      }
      await load(weekStart);
      setStatus({ kind: "ok", msg: `Copied ${prev.length} shift(s)` });
    } catch (e) {
      setStatus({ kind: "err", msg: "Copy failed" });
      console.error(e);
    }
  };

  /* ---------- render ---------- */

  if (!weekStart) return <div className={styles.page} />;

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const todayISO = toISODate(new Date());
  const fmtShort = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekLabel = `${fmtShort(weekStart)} – ${fmtShort(addDays(weekStart, 6))}, ${addDays(weekStart, 6).getFullYear()}`;

  const hours = [];
  for (let m = DAY_START; m <= DAY_END; m += 60) hours.push(m);
  const bodyHeight = (DAY_END - DAY_START) * PX_PER_MIN;

  const openCount = shifts.filter((s) => !s.person.trim()).length;

  const renderCard = (s: Shift, lane: number, laneCount: number) => {
    const top = (s.start_min - DAY_START) * PX_PER_MIN;
    const height = Math.max(18, (s.end_min - s.start_min) * PX_PER_MIN);
    const isDragged = drag?.kind === "resize" && drag.shift.id === s.id;
    return (
      <a
        key={s.id}
        href={`/staff/shift?id=${s.id}`}
        target="_blank"
        rel="noreferrer"
        draggable={false}
        className={[
          styles.card,
          s.person.trim() ? styles.cardFilled : styles.cardEmpty,
          isDragged ? styles.cardDragged : "",
        ].join(" ")}
        style={{
          top,
          height,
          left: `${(lane / laneCount) * 100}%`,
          width: `calc(${100 / laneCount}% - 3px)`,
        }}
        onClick={(e) => {
          if (Date.now() < suppressClickUntil.current) e.preventDefault();
        }}
      >
        <div
          className={`${styles.handle} ${styles.handleTop}`}
          onPointerDown={(e) => onHandlePointerDown(e, s, "start")}
        />
        <div className={styles.cardBody}>
          <span className={styles.cardTitle}>
            {s.emoji} {s.title}
          </span>
          <span className={styles.cardPerson}>{s.person.trim() || "unassigned"}</span>
          <span className={styles.cardTime}>
            {fmtMin(s.start_min)}–{fmtMin(s.end_min)}
          </span>
        </div>
        <div
          className={`${styles.handle} ${styles.handleBottom}`}
          onPointerDown={(e) => onHandlePointerDown(e, s, "end")}
        />
      </a>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.top}>
          <h1>Shift Schedule</h1>
          <div className={styles.toolbar}>
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              ‹
            </button>
            <button onClick={() => setWeekStart(mondayOf(new Date()))}>Today</button>
            <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              ›
            </button>
            <span className={styles.weekLabel}>{weekLabel}</span>
            <span className={styles.spacer} />
            <button onClick={copyLastWeek}>Copy last week</button>
            <button
              className={styles.primary}
              onClick={() =>
                setDraft({
                  day: toISODate(weekStart),
                  startMin: 9 * 60,
                  endMin: 14 * 60,
                  emoji: "🍽️",
                  title: "",
                  person: "",
                })
              }
            >
              + Add shift
            </button>
          </div>
        </header>

        {banner && <div className={styles.banner}>{banner}</div>}

        <div className={styles.statuskey}>
          <i>
            <span className={`${styles.swatch} ${styles.swatchF}`} /> Covered
          </i>
          <i>
            <span className={`${styles.swatch} ${styles.swatchE}`} /> Nobody assigned yet
          </i>
          <i className={styles.hint}>Drag on empty space to add a shift · drag a card’s edges to change its times · click a card for details</i>
        </div>

        <div className={styles.boardScroll}>
          <div className={styles.board}>
            <div className={styles.gutter}>
              <div className={styles.gutterHead} />
              <div className={styles.gutterBody} style={{ height: bodyHeight }}>
                {hours.map((m) => (
                  <span
                    key={m}
                    className={styles.hourLabel}
                    style={{ top: (m - DAY_START) * PX_PER_MIN }}
                  >
                    {fmtMin(m)}
                  </span>
                ))}
              </div>
            </div>
            {days.map((d) => {
              const dayISO = toISODate(d);
              const dayShifts = shifts.filter((s) => s.day === dayISO);
              const { laneOf, laneCount } = layoutLanes(dayShifts);
              const ghost =
                drag?.kind === "create" && drag.day === dayISO ? drag : null;
              return (
                <div
                  key={dayISO}
                  className={styles.daycol}
                  style={{ flexGrow: laneCount, minWidth: 132 * laneCount }}
                >
                  <div
                    className={`${styles.dayhead} ${dayISO === todayISO ? styles.dayheadToday : ""}`}
                  >
                    <strong>{d.toLocaleDateString("en-US", { weekday: "short" })}</strong>
                    <em>{fmtShort(d)}</em>
                  </div>
                  <div
                    className={styles.daybody}
                    data-daybody
                    style={{ height: bodyHeight }}
                    onPointerDown={(e) => onBodyPointerDown(e, dayISO)}
                  >
                    {dayShifts.map((s) => renderCard(s, laneOf.get(s.id) ?? 0, laneCount))}
                    {ghost && (
                      <div
                        className={styles.ghost}
                        style={{
                          top: (ghost.startMin - DAY_START) * PX_PER_MIN,
                          height: (ghost.endMin - ghost.startMin) * PX_PER_MIN,
                        }}
                      >
                        {fmtMin(ghost.startMin)}–{fmtMin(ghost.endMin)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className={styles.footer}>
          <button onClick={() => window.print()}>Print</button>
          <span className={openCount ? styles.countOpen : styles.countDone}>
            {openCount
              ? `${openCount} shift${openCount === 1 ? "" : "s"} unassigned`
              : shifts.length
                ? "Every shift covered"
                : "No shifts this week"}
          </span>
          <span className={styles.status}>
            <span className={`${styles.dot} ${DOT_CLASS[status.kind]}`} />
            <span>{status.msg}</span>
          </span>
        </footer>
      </div>

      {draft && (
        <div className={styles.overlay} onPointerDown={() => setDraft(null)}>
          <form
            className={styles.popover}
            onPointerDown={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const ns: NewShift = {
                day: draft.day,
                start_min: draft.startMin,
                end_min: draft.endMin,
                emoji: draft.emoji.trim() || "🍽️",
                title: draft.title.trim() || "Shift",
                person: draft.person.trim(),
                notes: "",
                checklist: [],
              };
              setDraft(null);
              createShift(ns);
            }}
          >
            <h2>New shift</h2>
            <div className={styles.formRow}>
              <input
                className={styles.emojiInput}
                value={draft.emoji}
                onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
                aria-label="Emoji icon"
              />
              <input
                autoFocus
                placeholder="Title (e.g. Kitchen)"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className={styles.formRow}>
              <input
                placeholder="Person — leave empty if open"
                value={draft.person}
                onChange={(e) => setDraft({ ...draft, person: e.target.value })}
              />
            </div>
            <div className={styles.formRow}>
              <select
                value={draft.day}
                onChange={(e) => setDraft({ ...draft, day: e.target.value })}
                aria-label="Day"
              >
                {days.map((d) => (
                  <option key={toISODate(d)} value={toISODate(d)}>
                    {d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                  </option>
                ))}
              </select>
              <input
                type="time"
                step={SNAP * 60}
                value={fmtMin(draft.startMin)}
                onChange={(e) =>
                  e.target.value && setDraft({ ...draft, startMin: parseTime(e.target.value) })
                }
                aria-label="Start time"
              />
              <input
                type="time"
                step={SNAP * 60}
                value={fmtMin(draft.endMin)}
                onChange={(e) =>
                  e.target.value && setDraft({ ...draft, endMin: parseTime(e.target.value) })
                }
                aria-label="End time"
              />
            </div>
            <div className={styles.formActions}>
              <button type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className={styles.primary} disabled={draft.endMin <= draft.startMin}>
                Add shift
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
