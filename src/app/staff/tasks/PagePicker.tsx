"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./tasks.module.css";

/** Somewhere blocks can be sent: a page, an untouched occurrence, a template, or a new page. */
export type PickTarget = {
  key: string;
  title: string;
  emoji: string;
  /** Group heading in the list ("Today", "Tue 15 Sept", "Ongoing", "Templates"). */
  group: string;
  /** Real page id; absent for a virtual occurrence or "new page". */
  pageId?: string;
  virtual?: { templateId: string; day: string };
  isTemplate?: boolean;
  isNew?: boolean;
};

type Props = {
  title: string;
  load: () => Promise<PickTarget[]>;
  onPick: (t: PickTarget) => void;
  onCancel: () => void;
};

/** Modal list of pages to move or copy blocks to, with a title filter. */
export default function PagePicker({ title, load, onPick, onCancel }: Props) {
  const [targets, setTargets] = useState<PickTarget[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((t) => {
        if (!cancelled) setTargets(t);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const needle = q.trim().toLowerCase();
  const shown = (targets ?? []).filter(
    (t) => t.isNew || !needle || t.title.toLowerCase().includes(needle) || t.group.toLowerCase().includes(needle)
  );
  const groups = [...new Set(shown.map((t) => t.group))];

  return (
    <div className={styles.modalBack} onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className={`${styles.modal} ${styles.pickerModal}`} role="dialog" aria-label={title}>
        <h3 className={styles.modalTitle}>{title}</h3>
        <input
          ref={inputRef}
          value={q}
          placeholder="Find a page…"
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a page"
        />
        <div className={styles.pickerList}>
          {error ? (
            <p className={styles.popNote}>Couldn’t load pages.</p>
          ) : targets === null ? (
            <p className={styles.popNote}>Loading…</p>
          ) : shown.length === 0 ? (
            <p className={styles.popNote}>No page matches.</p>
          ) : (
            groups.map((g) => (
              <div key={g}>
                <div className={styles.popHead}>{g}</div>
                {shown
                  .filter((t) => t.group === g)
                  .map((t) => (
                    <button
                      type="button"
                      key={t.key}
                      className={`${styles.popRowMain} ${styles.pickerRow}`}
                      onClick={() => onPick(t)}
                    >
                      <span className={styles.popRowEmoji}>{t.isNew ? "＋" : t.emoji || "📄"}</span>
                      <span className={styles.popRowTitle}>{t.title || "Untitled"}</span>
                      {t.virtual && <span className={styles.repeatMark}>↻</span>}
                      {t.isTemplate && <span className={styles.tag}>Template</span>}
                    </button>
                  ))}
              </div>
            ))
          )}
        </div>
        <div className={styles.modalActions}>
          <button type="button" className={styles.popItemSmall} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
