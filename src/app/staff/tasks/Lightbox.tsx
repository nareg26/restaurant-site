"use client";

import React, { useEffect, useRef, useState } from "react";
import type { ImageRef } from "@/lib/tasks-store";
import { imageUrl } from "@/lib/tasks-images";
import styles from "./tasks.module.css";

type Props = {
  images: ImageRef[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  onRemove: (image: ImageRef) => void;
  onAdd: (files: File[]) => void;
  adding: boolean;
};

const SWIPE_PX = 40;

/** Full-screen viewer for a block's images: swipe or arrow through them. */
export default function Lightbox({ images, index, onIndex, onClose, onRemove, onAdd, adding }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [touchX, setTouchX] = useState<number | null>(null);
  const count = images.length;
  const i = Math.min(index, count - 1);
  const img = images[i];

  const prev = () => count > 1 && onIndex((i - 1 + count) % count);
  const next = () => count > 1 && onIndex((i + 1) % count);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (count === 0) onClose();
  }, [count, onClose]);

  if (!img) return null;

  return (
    <div className={styles.lightbox} role="dialog" aria-label="Image viewer">
      <div className={styles.lbTop}>
        <span className={styles.lbCount}>{count > 1 ? `${i + 1} / ${count}` : ""}</span>
        <button type="button" onClick={() => fileRef.current?.click()} disabled={adding}>
          {adding ? "Adding…" : "＋ Add photo"}
        </button>
        <button
          type="button"
          className={styles.lbDanger}
          onClick={() => {
            if (confirm("Remove this photo from the block?")) onRemove(img);
          }}
        >
          Remove
        </button>
        <button type="button" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (files.length) onAdd(files);
          }}
        />
      </div>
      <div
        className={styles.lbBody}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        onTouchStart={(e) => setTouchX(e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          if (touchX === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
          setTouchX(null);
          if (dx > SWIPE_PX) prev();
          else if (dx < -SWIPE_PX) next();
        }}
      >
        {count > 1 && (
          <button type="button" className={`${styles.lbArrow} ${styles.lbPrev}`} onClick={prev} aria-label="Previous">
            ‹
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={img.id} className={styles.lbImg} src={imageUrl(img.path)} alt="" width={img.w} height={img.h} />
        {count > 1 && (
          <button type="button" className={`${styles.lbArrow} ${styles.lbNext}`} onClick={next} aria-label="Next">
            ›
          </button>
        )}
      </div>
    </div>
  );
}
