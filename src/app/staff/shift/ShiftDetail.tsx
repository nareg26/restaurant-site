"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SHARED, store, type ChecklistItem, type NewShift, type Shift } from "@/lib/shifts-store";
import { fmtMin, fromISODate, parseTime } from "@/lib/time";
import styles from "./shift.module.css";

type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };

export default function ShiftDetail() {
  const id = useSearchParams().get("id");
  const [shift, setShift] = useState<Shift | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "deleted">("loading");
  const [status, setStatus] = useState<Status>({ kind: "", msg: "" });
  const [newItem, setNewItem] = useState("");

  const patchRef = useRef<Partial<NewShift>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) {
      setState("missing");
      return;
    }
    store
      .get(id)
      .then((s) => {
        setShift(s);
        setState(s ? "ready" : "missing");
      })
      .catch((e) => {
        console.error(e);
        setState("missing");
      });
  }, [id]);

  const queueSave = useCallback(
    (patch: Partial<NewShift>) => {
      if (!id) return;
      patchRef.current = { ...patchRef.current, ...patch };
      setStatus({ kind: "busy", msg: "Saving…" });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const toSave = patchRef.current;
        patchRef.current = {};
        try {
          await store.update(id, toSave);
          setStatus({
            kind: "ok",
            msg: SHARED ? "Saved · visible to the team" : "Saved in this browser",
          });
        } catch (e) {
          console.error(e);
          patchRef.current = { ...toSave, ...patchRef.current }; // keep for retry
          setStatus({ kind: "err", msg: "Save failed — edit again to retry" });
        }
      }, 600);
    },
    [id]
  );

  const edit = (patch: Partial<NewShift>) => {
    setShift((s) => (s ? { ...s, ...patch } : s));
    queueSave(patch);
  };

  const editChecklist = (items: ChecklistItem[]) => edit({ checklist: items });

  const remove = async () => {
    if (!id || !shift) return;
    if (!confirm(`Delete "${shift.emoji} ${shift.title}"? This can’t be undone.`)) return;
    try {
      await store.remove(id);
      setState("deleted");
    } catch (e) {
      console.error(e);
      setStatus({ kind: "err", msg: "Delete failed" });
    }
  };

  if (state === "loading") return <div className={styles.page} />;

  if (state === "missing" || state === "deleted")
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>{state === "deleted" ? "Shift deleted" : "Shift not found"}</h1>
          <p className={styles.muted}>
            {state === "deleted"
              ? "You can close this tab."
              : "It may have been deleted, or the link is incomplete."}
          </p>
          <a href="/staff/schedule">← Back to the schedule</a>
        </div>
      </div>
    );

  const s = shift!;
  const open = !s.person.trim();
  const doneCount = s.checklist.filter((i) => i.done).length;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.crumbs}>
          <a href="/staff/schedule">← Schedule</a>
          <span className={`${styles.pill} ${open ? styles.pillOpen : styles.pillFilled}`}>
            {open ? "Nobody assigned yet" : "Covered"}
          </span>
        </div>

        <div className={styles.titleRow}>
          <input
            className={styles.emoji}
            value={s.emoji}
            onChange={(e) => edit({ emoji: e.target.value })}
            aria-label="Emoji icon"
          />
          <input
            className={styles.title}
            value={s.title}
            placeholder="Shift title"
            onChange={(e) => edit({ title: e.target.value })}
            aria-label="Title"
          />
        </div>

        <div className={styles.grid}>
          <label>
            Day
            <input
              type="date"
              value={s.day}
              onChange={(e) => e.target.value && edit({ day: e.target.value })}
            />
          </label>
          <label>
            Start
            <input
              type="time"
              step={900}
              value={fmtMin(s.start_min)}
              onChange={(e) => e.target.value && edit({ start_min: parseTime(e.target.value) })}
            />
          </label>
          <label>
            End
            <input
              type="time"
              step={900}
              value={fmtMin(s.end_min)}
              onChange={(e) => e.target.value && edit({ end_min: parseTime(e.target.value) })}
            />
          </label>
        </div>
        <p className={styles.muted}>
          {fromISODate(s.day).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}{" "}
          · {fmtMin(s.start_min)}–{fmtMin(s.end_min)}
        </p>

        <label className={styles.field}>
          Person
          <input
            className={open ? styles.personOpen : undefined}
            value={s.person}
            placeholder="Who's on? Leave empty if the shift is open"
            onChange={(e) => edit({ person: e.target.value })}
          />
        </label>

        <label className={styles.field}>
          Notes
          <textarea
            rows={4}
            value={s.notes}
            placeholder="Anything the person on shift should know…"
            onChange={(e) => edit({ notes: e.target.value })}
          />
        </label>

        <div className={styles.field}>
          <span>
            Checklist
            {s.checklist.length > 0 && (
              <span className={styles.muted}>
                {" "}
                · {doneCount}/{s.checklist.length} done
              </span>
            )}
          </span>
          <ul className={styles.checklist}>
            {s.checklist.map((item) => (
              <li key={item.id}>
                <input
                  type="checkbox"
                  checked={item.done}
                  onChange={(e) =>
                    editChecklist(
                      s.checklist.map((i) =>
                        i.id === item.id ? { ...i, done: e.target.checked } : i
                      )
                    )
                  }
                  aria-label={`Done: ${item.text}`}
                />
                <input
                  className={`${styles.itemText} ${item.done ? styles.itemDone : ""}`}
                  value={item.text}
                  onChange={(e) =>
                    editChecklist(
                      s.checklist.map((i) =>
                        i.id === item.id ? { ...i, text: e.target.value } : i
                      )
                    )
                  }
                  aria-label="Checklist item"
                />
                <button
                  type="button"
                  className={styles.itemRemove}
                  onClick={() => editChecklist(s.checklist.filter((i) => i.id !== item.id))}
                  aria-label={`Remove: ${item.text}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <form
            className={styles.addItem}
            onSubmit={(e) => {
              e.preventDefault();
              const text = newItem.trim();
              if (!text) return;
              editChecklist([...s.checklist, { id: crypto.randomUUID(), text, done: false }]);
              setNewItem("");
            }}
          >
            <input
              value={newItem}
              placeholder="Add a checklist item…"
              onChange={(e) => setNewItem(e.target.value)}
            />
            <button type="submit" disabled={!newItem.trim()}>
              Add
            </button>
          </form>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.danger} onClick={remove}>
            Delete shift
          </button>
          <span className={styles.statusText} data-kind={status.kind}>
            {status.msg}
          </span>
        </div>
      </div>
    </div>
  );
}
