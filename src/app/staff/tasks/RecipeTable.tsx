"use client";

import React, { useState } from "react";
import type { RecipeRow } from "@/lib/tasks-store";
import { fmtAmount, newRow, parseAmount } from "@/lib/tasks-recipe";
import styles from "./tasks.module.css";

type Props = {
  rows: RecipeRow[];
  scale: number;
  /** Templates edit rows; pages only scale. */
  editable: boolean;
  onRows: (rows: RecipeRow[]) => void;
  onScale: (scale: number) => void;
};

export default function RecipeTable({ rows, scale, editable, onRows, onScale }: Props) {
  return editable ? (
    <TemplateTable rows={rows} onRows={onRows} />
  ) : (
    <PageTable rows={rows} scale={scale} onScale={onScale} />
  );
}

/* ---------- template: define the ingredients ---------- */

function TemplateTable({ rows, onRows }: { rows: RecipeRow[]; onRows: (r: RecipeRow[]) => void }) {
  // Raw amount text while typing, so "1." or "0,5" don't get clobbered mid-way.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const update = (id: string, patch: Partial<RecipeRow>) =>
    onRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onRows(next);
  };

  return (
    <div className={styles.recipe}>
      <p className={styles.recipeHint}>
        Amount, unit and ingredient. Pages made from this template scale every amount together.
      </p>
      {rows.length > 0 && (
        <div className={styles.rtHead}>
          <span>Amount</span>
          <span>Unit</span>
          <span>Ingredient</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={r.id} className={styles.rtRow}>
          <input
            className={styles.rtAmount}
            inputMode="decimal"
            value={drafts[r.id] ?? (r.amount === 0 ? "" : fmtAmount(r.amount))}
            placeholder="0"
            onChange={(e) => {
              const raw = e.target.value;
              setDrafts((d) => ({ ...d, [r.id]: raw }));
              const n = parseAmount(raw);
              if (n !== null) update(r.id, { amount: n });
              else if (raw.trim() === "") update(r.id, { amount: 0 });
            }}
            onBlur={() =>
              setDrafts((d) => {
                const { [r.id]: _gone, ...rest } = d;
                void _gone;
                return rest;
              })
            }
            aria-label="Amount"
          />
          <input
            className={styles.rtUnit}
            value={r.unit}
            placeholder="g"
            onChange={(e) => update(r.id, { unit: e.target.value })}
            aria-label="Unit"
          />
          <input
            className={styles.rtName}
            value={r.name}
            placeholder="flour"
            onChange={(e) => update(r.id, { name: e.target.value })}
            aria-label="Ingredient"
          />
          <span className={styles.rtTools}>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              ↑
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === rows.length - 1}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className={styles.rtDelete}
              onClick={() => onRows(rows.filter((x) => x.id !== r.id))}
              aria-label={`Remove ${r.name || "row"}`}
            >
              ✕
            </button>
          </span>
        </div>
      ))}
      <button type="button" className={styles.rtAdd} onClick={() => onRows([...rows, newRow()])}>
        ＋ Add ingredient
      </button>
    </div>
  );
}

/* ---------- page: pick a base row and scale everything ---------- */

function PageTable({
  rows,
  scale,
  onScale,
}: {
  rows: RecipeRow[];
  scale: number;
  onScale: (s: number) => void;
}) {
  const [base, setBase] = useState<{ id: string; raw: string } | null>(null);
  const scaled = scale !== 1;

  if (rows.length === 0)
    return (
      <div className={styles.recipe}>
        <p className={styles.recipeHint}>No ingredients in this recipe yet. Add them on the template.</p>
      </div>
    );

  return (
    <div className={styles.recipe}>
      <div className={styles.recipeBar}>
        <span className={styles.recipeHint}>
          Tap an amount and change it; everything else follows.
        </span>
        {scaled && (
          <>
            <span className={styles.scaleBadge}>×{fmtAmount(scale)}</span>
            <button type="button" className={styles.popItemSmall} onClick={() => onScale(1)}>
              Reset
            </button>
          </>
        )}
      </div>
      {rows.map((r) => {
        const isBase = base?.id === r.id;
        const canBase = r.amount > 0;
        return (
          <div key={r.id} className={`${styles.rtRow} ${styles.rtRowPage} ${isBase ? styles.rtBase : ""}`}>
            {isBase ? (
              <input
                className={`${styles.rtAmount} ${styles.rtAmountBase}`}
                inputMode="decimal"
                autoFocus
                onFocus={(e) => e.target.select()} // typing replaces the old amount
                value={base.raw}
                onChange={(e) => {
                  const raw = e.target.value;
                  setBase({ id: r.id, raw });
                  const n = parseAmount(raw);
                  if (n !== null && n > 0) onScale(n / r.amount);
                }}
                onBlur={() => setBase(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
                }}
                aria-label={`Amount of ${r.name}`}
              />
            ) : (
              <button
                type="button"
                className={`${styles.rtAmount} ${styles.rtAmountBtn}`}
                disabled={!canBase}
                onClick={() => setBase({ id: r.id, raw: fmtAmount(r.amount * scale) })}
                title={canBase ? "Change this amount and scale the rest" : undefined}
              >
                {fmtAmount(r.amount * scale)}
              </button>
            )}
            <span className={styles.rtUnitText}>{r.unit}</span>
            <span className={styles.rtNameText}>{r.name}</span>
          </div>
        );
      })}
    </div>
  );
}
