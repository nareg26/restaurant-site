"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./tasks.module.css";

const CHOICES = [
  "🍞", "🥐", "🥖", "🧀", "🥚", "🥩", "🍗", "🐟", "🦐", "🥬", "🥕", "🧅",
  "🧄", "🍅", "🥔", "🍋", "🍎", "🍓", "🫐", "🍫", "🧈", "🥛", "☕", "🍷",
  "🍺", "🧊", "🧂", "🫙", "🍽️", "🥣", "🔪", "🍳", "🥘", "🍲", "🥗", "🍰",
  "🧁", "🍪", "🥧", "🍕", "🌮", "🍔", "🍝", "🍜", "🍚", "🥟", "🧹", "🧽",
  "🧼", "🗑️", "📦", "🚚", "📋", "📝", "📌", "⏰", "🔥", "❄️", "⚠️", "✅",
  "⭐", "❤️", "🎉", "🎂", "🎈", "👋", "💡", "🔧", "🧾", "💶", "📞", "🏷️",
];

type Props = { value: string; onChange: (emoji: string) => void };

/** Icon button that opens a small grid of emoji; any emoji can be typed too. */
export default function EmojiPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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

  const pick = (e: string) => {
    onChange(e);
    setOpen(false);
    setCustom("");
  };

  return (
    <div className={styles.menuRoot} ref={rootRef}>
      <button
        type="button"
        className={`${styles.emojiBtn} ${value ? "" : styles.emojiEmpty}`}
        aria-label="Choose an icon"
        onClick={() => setOpen((o) => !o)}
      >
        {value || "＋"}
      </button>
      {open && (
        <div className={`${styles.popover} ${styles.popLeft} ${styles.emojiPop}`}>
          <div className={styles.emojiGrid}>
            {CHOICES.map((e) => (
              <button
                type="button"
                key={e}
                className={`${styles.emojiCell} ${e === value ? styles.emojiCellOn : ""}`}
                onClick={() => pick(e)}
              >
                {e}
              </button>
            ))}
          </div>
          <div className={styles.emojiFoot}>
            <input
              value={custom}
              placeholder="Any emoji…"
              maxLength={4}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) pick(custom.trim());
              }}
              aria-label="Type any emoji"
            />
            <button
              type="button"
              className={styles.popGo}
              disabled={!custom.trim()}
              onClick={() => pick(custom.trim())}
            >
              Use
            </button>
            {value && (
              <button type="button" className={styles.popItemSmall} onClick={() => pick("")}>
                Remove
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
