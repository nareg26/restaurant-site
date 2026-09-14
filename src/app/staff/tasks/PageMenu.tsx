"use client";

import React, { useEffect, useRef, useState } from "react";
import { addDays, toISODate } from "@/lib/time";
import styles from "./tasks.module.css";

type Props = {
  /** The page's current day (null = undated), so the move panel can hide it. */
  currentDay: string | null;
  onMove: (day: string | null) => void;
  onDelete: () => void;
  /** Where the popover opens relative to the button. */
  align?: "left" | "right";
  label?: string;
  /** Templates can't be moved to a day. */
  canMove?: boolean;
  /** "Delete" normally; "Skip this day" for an untouched repeat occurrence. */
  deleteLabel?: string;
  /** Extra entries shown above Move to. */
  extra?: { label: string; onClick: () => void }[];
};

/** The "⋯" context menu shared by sidebar thumbnails and the open page. */
export default function PageMenu({
  currentDay,
  onMove,
  onDelete,
  align = "right",
  label,
  canMove = true,
  deleteLabel = "Delete",
  extra = [],
}: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"main" | "move">("main");
  const [picked, setPicked] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setView("main");
    setPicked("");
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const move = (day: string | null) => {
    close();
    if (day !== currentDay) onMove(day);
  };

  const today = toISODate(new Date());
  const tomorrow = toISODate(addDays(new Date(), 1));

  return (
    <div className={styles.menuRoot} ref={rootRef}>
      <button
        type="button"
        className={styles.menuBtn}
        aria-label={label ?? "Page menu"}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close();
          else setOpen(true);
        }}
      >
        ⋯
      </button>
      {open && (
        <div
          className={`${styles.popover} ${align === "left" ? styles.popLeft : styles.popRight}`}
          onClick={(e) => e.stopPropagation()}
        >
          {view === "main" ? (
            <>
              {extra.map((x) => (
                <button
                  type="button"
                  key={x.label}
                  className={styles.popItem}
                  onClick={() => {
                    close();
                    x.onClick();
                  }}
                >
                  {x.label}
                </button>
              ))}
              {canMove && (
                <button type="button" className={styles.popItem} onClick={() => setView("move")}>
                  Move to…
                </button>
              )}
              <button
                type="button"
                className={`${styles.popItem} ${styles.popDanger}`}
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                {deleteLabel}
              </button>
            </>
          ) : (
            <>
              <div className={styles.popHead}>Move to</div>
              {currentDay !== today && (
                <button type="button" className={styles.popItem} onClick={() => move(today)}>
                  Today
                </button>
              )}
              {currentDay !== tomorrow && (
                <button type="button" className={styles.popItem} onClick={() => move(tomorrow)}>
                  Tomorrow
                </button>
              )}
              {currentDay !== null && (
                <button type="button" className={styles.popItem} onClick={() => move(null)}>
                  Ongoing
                </button>
              )}
              <div className={styles.popDateRow}>
                <input
                  type="date"
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  aria-label="Pick a day"
                />
                <button
                  type="button"
                  className={styles.popGo}
                  disabled={!picked}
                  onClick={() => picked && move(picked)}
                >
                  Go
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
