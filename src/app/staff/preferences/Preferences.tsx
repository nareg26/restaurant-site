"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DAYS,
  MARKS,
  PER_SLOT_MAX,
  SLOTS,
  WANT_BUDGET,
  type MarkKind,
  type Slot,
} from "@/lib/prefs-config";
import {
  SHARED,
  getLastId,
  parseId,
  rememberLastId,
  store,
  type PublicPrefRow,
} from "@/lib/prefs-store";
import Results from "./Results";
import styles from "./preferences.module.css";

export default function Preferences() {
  const [tab, setTab] = useState<"form" | "results">("form");
  const [personId, setPersonId] = useState("");
  const [lookupMsg, setLookupMsg] = useState("");
  const [name, setName] = useState("");
  const [hours, setHours] = useState("");
  const [marks, setMarks] = useState<Partial<Record<string, MarkKind>>>({});
  const [points, setPoints] = useState<Partial<Record<string, number>>>({});
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false); // a lookup for this ID is in flight
  const [statusMsg, setStatusMsg] = useState("");
  const [rows, setRows] = useState<PublicPrefRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const idRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<number | null>(null); // ID whose saved answers are on screen
  const loadedMsg = useRef(""); // the message that goes with it

  const idNum = parseId(personId);

  const spent = Object.entries(points).reduce(
    (sum, [id, p]) => (marks[id] === "want" ? sum + (p || 0) : sum),
    0
  );
  const left = WANT_BUDGET - spent;

  const fetchAll = useCallback(async () => {
    try {
      setRows(await store.listAll());
      setLoadError(false);
    } catch (e) {
      console.error(e);
      setLoadError(true);
    }
  }, []);

  /* prefill the ID last used on this device, purely as a convenience */
  useEffect(() => {
    setPersonId(getLastId());
  }, []);

  /* Entering an ID pulls up that person's saved answers, from any device. */
  useEffect(() => {
    if (idNum === null) {
      setChecking(false);
      setLookupMsg(personId.trim() ? "IDs are numbers — check the one you were given." : "");
      return;
    }
    if (loadedFor.current === idNum) {
      setChecking(false);
      setLookupMsg(loadedMsg.current); // already showing this person; drop any stale warning
      return;
    }
    // Saving before this finishes would write a blank form over their answers.
    setChecking(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const mine = await store.getMine(idNum);
        if (cancelled) return;
        const previous = loadedFor.current;
        loadedFor.current = idNum;
        if (mine) {
          setName(mine.name);
          setHours(mine.hours_per_week === null ? "" : String(mine.hours_per_week));
          setMarks(mine.marks);
          setPoints(mine.points);
          setNotes(mine.notes);
          setSaved(true);
          loadedMsg.current = `Loaded saved answers for #${idNum}${mine.name ? ` — ${mine.name}` : ""}.`;
          setLookupMsg(loadedMsg.current);
          setStatusMsg("");
        } else {
          // Never let one person's answers get saved under another's ID.
          if (previous !== null && previous !== idNum) {
            setName("");
            setHours("");
            setMarks({});
            setPoints({});
            setNotes("");
          }
          setSaved(false);
          loadedMsg.current = `#${idNum} hasn’t answered yet — fill this in and save.`;
          setLookupMsg(loadedMsg.current);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setLookupMsg("Couldn’t check that ID just now.");
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [idNum, personId]);

  /* results stay fresh while that tab is open */
  useEffect(() => {
    if (tab !== "results") return;
    fetchAll();
    if (!SHARED) return;
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [tab, fetchAll]);

  const setMark = (slotId: string, mark: MarkKind) => {
    setSaved((s) => s); // keep "Update" label once saved
    if (marks[slotId] === mark) {
      const { [slotId]: _m, ...restMarks } = marks;
      const { [slotId]: _p, ...restPoints } = points;
      void _m;
      void _p;
      setMarks(restMarks);
      setPoints(restPoints);
    } else {
      setMarks({ ...marks, [slotId]: mark });
      if (mark !== "want") {
        const { [slotId]: _p, ...restPoints } = points;
        void _p;
        setPoints(restPoints);
      }
    }
  };

  const bump = (slotId: string, delta: number) => {
    if (marks[slotId] !== "want") return;
    // Read the running total inside the updater so rapid clicks don't each
    // act on the same stale value and lose increments.
    setPoints((prev) => {
      const cur = prev[slotId] || 0;
      const next = Math.max(0, Math.min(PER_SLOT_MAX, cur + delta));
      const prevSpent = Object.entries(prev).reduce(
        (sum, [id, p]) => (marks[id] === "want" ? sum + (p || 0) : sum),
        0
      );
      if (prevSpent - cur + next > WANT_BUDGET) return prev;
      return { ...prev, [slotId]: next };
    });
  };

  const save = async () => {
    if (idNum === null) {
      setStatusMsg("Enter the ID number you were given.");
      idRef.current?.focus();
      return;
    }
    if (checking) {
      // Their saved answers are still loading; saving now would blank them.
      setStatusMsg("Just a second — still checking that ID.");
      return;
    }
    if (!name.trim()) {
      setStatusMsg("Add your name first so the schedule can be built.");
      nameRef.current?.focus();
      return;
    }
    setSaving(true);
    setStatusMsg("Saving…");
    try {
      await store.upsert({
        id: idNum,
        name: name.trim(),
        hours_per_week: hours.trim() === "" ? null : Number(hours),
        marks,
        points,
        notes,
      });
      rememberLastId(idNum);
      loadedFor.current = idNum;
      loadedMsg.current = `These answers are saved under #${idNum} — ${name.trim()}.`;
      setLookupMsg(loadedMsg.current);
      setSaved(true);
      setStatusMsg(
        SHARED
          ? "Saved. Change anything and save again."
          : "Saved in this browser. Change anything and save again."
      );
      fetchAll();
    } catch (e) {
      console.error(e);
      setStatusMsg("Didn’t save: " + String(e instanceof Error ? e.message : e));
    } finally {
      setSaving(false);
    }
  };

  const markedCount = Object.keys(marks).length;
  const defaultStatus = `${markedCount} of ${SLOTS.length} shifts marked`;

  const renderSlot = (slot: Slot, dayLabel: string) => {
    const mark = marks[slot.id];
    const pts = points[slot.id] || 0;
    return (
      <div key={slot.id} className={styles.slot}>
        <div className={styles.slotTop}>
          <span className={styles.slotTime}>
            {slot.label} <span className={styles.dur}>({slot.dur})</span>
          </span>
          {slot.note && <span className={styles.slotNote}>{slot.note}</span>}
        </div>
        <div className={styles.seg}>
          {MARKS.map((m) => (
            <button
              key={m.k}
              type="button"
              className={styles[m.k]}
              aria-pressed={mark === m.k}
              aria-label={`${m.label}, ${dayLabel} ${slot.label}`}
              onClick={() => setMark(slot.id, m.k)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mark === "want" && (
          <div className={styles.stepper}>
            <button
              type="button"
              disabled={pts === 0}
              aria-label={`Spend one point fewer on ${dayLabel} ${slot.label}`}
              onClick={() => bump(slot.id, -1)}
            >
              −
            </button>
            <span className={styles.val}>{pts}</span>
            <button
              type="button"
              disabled={left === 0 || pts === PER_SLOT_MAX}
              aria-label={`Spend one more point on ${dayLabel} ${slot.label}`}
              onClick={() => bump(slot.id, 1)}
            >
              +
            </button>
            <span>points on this one</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1>Which open shifts do you want?</h1>
          <p>
            Mark every shift below, then spend your {WANT_BUDGET} points on the ones you
            most want. It should take a few minutes. You can change your answers any time
            and re-submit.
          </p>
        </header>

        {!SHARED && (
          <div className={styles.banner}>
            <b>Not connected to Supabase yet.</b> Set the env vars in <code>.env.local</code>{" "}
            (see the README). Until then, answers save only in your own browser.
          </div>
        )}

        <div className={styles.tabs} role="tablist">
          <button
            className={styles.tab}
            role="tab"
            aria-selected={tab === "form"}
            onClick={() => setTab("form")}
          >
            My preferences
          </button>
          <button
            className={styles.tab}
            role="tab"
            aria-selected={tab === "results"}
            onClick={() => setTab("results")}
          >
            What everyone said
          </button>
        </div>

        {tab === "form" ? (
          <section role="tabpanel">
            <div className={styles.namebar}>
              <div className={styles.whoRow}>
                <div className={styles.idField}>
                  <label className={styles.label} htmlFor="pref-id">
                    Your ID
                  </label>
                  <input
                    ref={idRef}
                    id="pref-id"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 7"
                    value={personId}
                    onChange={(e) => setPersonId(e.target.value.replace(/[^\d]/g, ""))}
                  />
                </div>
                <div className={styles.nameField}>
                  <label className={styles.label} htmlFor="pref-name">
                    Your name
                  </label>
                  <input
                    ref={nameRef}
                    id="pref-name"
                    type="text"
                    autoComplete="given-name"
                    placeholder="e.g. Nur"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
              {lookupMsg && <p className={styles.lookup}>{lookupMsg}</p>}

              <div className={styles.hoursField}>
                <label className={styles.label} htmlFor="pref-hours">
                  How many hours do you want to work per week, ideally?
                </label>
                <div className={styles.hoursInput}>
                  <input
                    id="pref-hours"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="e.g. 20"
                    value={hours}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/[^\d]/g, "").slice(0, 2);
                      setHours(digits);
                    }}
                  />
                  <span>hours per week</span>
                </div>
              </div>
            </div>

            <div className={styles.meter}>
              <div className={styles.gauge}>
                <span className={styles.dots}>
                  {Array.from({ length: WANT_BUDGET }, (_, i) => (
                    <span key={i} className={`${styles.dot} ${i < left ? styles.on : ""}`} />
                  ))}
                </span>
                <span className={styles.txt}>
                  <b>{left}</b> points left
                </span>
              </div>
            </div>

            <div>
              {DAYS.map((day) => {
                const mine = SLOTS.filter((s) => s.day === day.id);
                return (
                  <div key={day.id} className={styles.day}>
                    <h2>
                      {day.label}
                      <span>
                        {mine.length === 1 ? "1 shift open" : `${mine.length} shifts open`}
                      </span>
                    </h2>
                    {mine.map((slot) => renderSlot(slot, day.label))}
                  </div>
                );
              })}
            </div>

            <div className={styles.qbox}>
              <label className={styles.label} htmlFor="pref-notes">
                Anything the grid doesn&rsquo;t capture?
              </label>
              <textarea
                id="pref-notes"
                placeholder="Childcare on Thursdays, need two weeks' notice for Saturdays, happy to be called in last minute…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className={styles.save}>
              <button onClick={save} disabled={saving || checking}>
                {saved ? "Update my preferences" : "Save my preferences"}
              </button>
              <span className={styles.status}>{statusMsg || defaultStatus}</span>
            </div>
          </section>
        ) : (
          <section role="tabpanel">
            <Results rows={rows} loadError={loadError} />
          </section>
        )}
      </div>
    </div>
  );
}
