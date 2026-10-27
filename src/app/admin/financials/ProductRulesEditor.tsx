"use client";

import React, { useState } from "react";
import {
  checkPin,
  listAllProducts,
  ruleKey,
  saveRules,
  type ProductRule,
  type ProductTotal,
} from "@/lib/fin-store";
import { applyRules, fmtQty, isAdjusted, partsLabel, tidyNames } from "@/lib/fin-rules";
import styles from "./dashboard.module.css";

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

/** One editable line: a till item, what it shows as, and its count multiplier. */
type Draft = { product: string; show_as: string; multiplier: string };

const toRules = (drafts: Draft[]): ProductRule[] =>
  drafts.map((d) => ({
    product: d.product,
    show_as: d.show_as.trim(),
    multiplier: Number(d.multiplier),
  }));

const validMultiplier = (s: string) => {
  const n = Number(s);
  return s.trim() !== "" && Number.isFinite(n) && n > 0 && n <= 1000;
};

export default function ProductRulesEditor({
  rules,
  products,
  amount,
  periodName,
  onSaved,
  onClose,
}: {
  rules: ProductRule[];
  products: ProductTotal[];
  amount: (p: { gross: number; net: number }) => number;
  periodName: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [status, setStatus] = useState<{ kind: "" | "busy" | "err"; msg: string }>({
    kind: "",
    msg: "",
  });

  /* Step 1: the PIN, checked before any editing happens. */
  const unlock = async () => {
    setStatus({ kind: "busy", msg: "Checking…" });
    try {
      await checkPin(pin);
      const items = await listAllProducts();
      // Every item ever sold, plus any rule whose item hasn't been sold lately.
      const byKey = new Map<string, Draft>();
      for (const it of items) {
        if (!byKey.has(ruleKey(it.product))) {
          byKey.set(ruleKey(it.product), { product: it.product, show_as: "", multiplier: "1" });
        }
      }
      for (const r of rules) {
        const d = byKey.get(r.product) ?? { product: r.product, show_as: "", multiplier: "1" };
        byKey.set(r.product, { ...d, show_as: r.show_as, multiplier: String(r.multiplier) });
      }
      setDrafts(
        [...byKey.values()].sort((a, b) =>
          a.product.localeCompare(b.product, "pt", { sensitivity: "base" }),
        ),
      );
      setStatus({ kind: "", msg: "" });
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Couldn’t check the PIN." });
    }
  };

  if (!drafts) {
    return (
      <form
        className={styles.editorPin}
        onSubmit={(e) => {
          e.preventDefault();
          unlock();
        }}
      >
        <p className={styles.muted}>
          Rename items or combine them for this list. Changing the rules needs the upload PIN.
        </p>
        <div className={styles.editorActions}>
          <label className={styles.editorField}>
            Upload PIN
            <input
              type="password"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoFocus
            />
          </label>
          <button type="submit" className={styles.primaryBtn}>
            Continue
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
        {status.msg && (
          <p className={styles.status} data-kind={status.kind}>
            {status.msg}
          </p>
        )}
      </form>
    );
  }

  /* Step 2: the rules. */
  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts(drafts.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  const invalid = drafts.filter((d) => !validMultiplier(d.multiplier));
  const preview = invalid.length
    ? []
    : tidyNames(applyRules(products, toRules(drafts)))
        .filter(isAdjusted)
        .sort((a, b) => amount(b) - amount(a));
  const names = [
    ...new Set([...drafts.map((d) => d.product), ...drafts.map((d) => d.show_as.trim())]),
  ].filter(Boolean);

  const save = async () => {
    if (invalid.length) {
      setStatus({
        kind: "err",
        msg: `Fix the count for ${invalid[0].product} (a number above 0).`,
      });
      return;
    }
    setStatus({ kind: "busy", msg: "Saving…" });
    try {
      await saveRules(pin, toRules(drafts));
      onSaved();
    } catch (e) {
      setStatus({ kind: "err", msg: e instanceof Error ? e.message : "Couldn’t save." });
    }
  };

  return (
    <div className={styles.editor}>
      <p className={styles.muted}>
        Leave “Show as” empty to keep the till’s name. Items shown under the same name become one
        row: their sales add up as sold, and each counts as many as you set.
      </p>
      <datalist id="fin-item-names">
        {names.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className={styles.rules}>
        <span className={styles.rulesHead}>On the till</span>
        <span className={styles.rulesHead}>Show as</span>
        <span className={styles.rulesHead}>Count each as</span>
        {drafts.map((d, i) => (
          <React.Fragment key={d.product}>
            <span className={styles.ruleItem}>{d.product}</span>
            <input
              type="text"
              list="fin-item-names"
              placeholder={d.product}
              value={d.show_as}
              onChange={(e) => update(i, { show_as: e.target.value })}
              aria-label={`Show ${d.product} as`}
            />
            <span className={styles.ruleMult}>
              ×
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={d.multiplier}
                onChange={(e) => update(i, { multiplier: e.target.value })}
                aria-invalid={!validMultiplier(d.multiplier) || undefined}
                aria-label={`Count each ${d.product} as`}
              />
            </span>
          </React.Fragment>
        ))}
      </div>

      <div className={styles.preview}>
        <div className={styles.previewTitle}>Preview, {periodName}</div>
        {invalid.length > 0 ? (
          <p className={styles.error}>Each count must be a number above 0.</p>
        ) : preview.length === 0 ? (
          <p className={styles.muted}>No item in this period is renamed or combined.</p>
        ) : (
          preview.map((r) => (
            <div key={r.name} className={styles.previewRow}>
              <span className={styles.previewName}>{r.name}</span>
              <span className={styles.previewNum}>{fmtQty(r.quantity)}</span>
              <span className={styles.previewNum}>{eur.format(amount(r))}</span>
              <span className={styles.previewParts}>{partsLabel(r)}</span>
            </div>
          ))
        )}
      </div>

      <div className={styles.editorActions}>
        <button type="button" className={styles.primaryBtn} onClick={save}>
          Save
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
        {status.msg && (
          <span className={styles.status} data-kind={status.kind}>
            {status.msg}
          </span>
        )}
      </div>
    </div>
  );
}
