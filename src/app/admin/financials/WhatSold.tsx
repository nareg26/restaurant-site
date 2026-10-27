"use client";

import React, { useCallback, useEffect, useState } from "react";
import { listRules, type ProductRule, type ProductTotal } from "@/lib/fin-store";
import { applyRules, asSold, fmtQty, isAdjusted, partsLabel, tidyNames } from "@/lib/fin-rules";
import ProductRulesEditor from "./ProductRulesEditor";
import styles from "./dashboard.module.css";

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const money = (n: number) => eur.format(n);
const pct = (n: number) => `${Math.round(n * 100)}%`;

const TOP_PRODUCTS = 10;
/** Per-device memory of the "Show cleaned list" switch. */
const CLEANED_KEY = "fin-what-sold-cleaned";

const readCleaned = () => {
  try {
    return localStorage.getItem(CLEANED_KEY) !== "0";
  } catch {
    return true;
  }
};

export default function WhatSold({
  products,
  amount,
  periodName,
  tp,
}: {
  products: ProductTotal[];
  amount: (p: { gross: number; net: number }) => number;
  periodName: string;
  tp: (lines: string[]) => object;
}) {
  const [rules, setRules] = useState<ProductRule[] | null>(null);
  const [rulesErr, setRulesErr] = useState(false);
  // The card only renders in the browser (after data loads), so localStorage is safe here.
  const [cleaned, setCleaned] = useState(readCleaned);
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      setRules(await listRules());
      setRulesErr(false);
    } catch (e) {
      console.error(e);
      setRules([]);
      setRulesErr(true);
    }
  }, []);

  useEffect(() => {
    // loadRules only sets state after the fetch resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRules();
  }, [loadRules]);

  const toggleCleaned = (on: boolean) => {
    setCleaned(on);
    try {
      localStorage.setItem(CLEANED_KEY, on ? "1" : "0");
    } catch {
      /* storage blocked: the switch still works for this visit */
    }
  };

  const rows = (cleaned && rules ? tidyNames(applyRules(products, rules)) : asSold(products)).sort(
    (a, b) => amount(b) - amount(a),
  );
  const total = rows.reduce((s, r) => s + amount(r), 0);
  const max = rows.length ? amount(rows[0]) : 1;
  const shown = all ? rows : rows.slice(0, TOP_PRODUCTS);

  return (
    <section className={styles.card}>
      <h2>
        What sold
        <span className={styles.cardTools}>
          <label className={styles.switch}>
            <input
              type="checkbox"
              role="switch"
              checked={cleaned}
              onChange={(e) => toggleCleaned(e.target.checked)}
            />
            Show cleaned list
          </label>
          {!editing && (
            <button type="button" className={styles.small} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </span>
      </h2>

      {editing && rules ? (
        <ProductRulesEditor
          rules={rules}
          products={products}
          amount={amount}
          periodName={periodName}
          onSaved={async () => {
            await loadRules();
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      ) : (
        <>
          <div className={styles.products}>
            <div className={`${styles.prodRow} ${styles.prodHeadRow}`}>
              <span className={styles.prodName}>Item</span>
              <span className={styles.prodBarCell}>Sales</span>
              <span className={styles.prodQty}>Qty</span>
              <span className={styles.prodShare}>Share</span>
            </div>
            {shown.map((r) => (
              <div key={r.name} className={styles.prodRow}>
                <span className={styles.prodName}>
                  {r.name}
                  {isAdjusted(r) && (
                    <span className={styles.adjusted} aria-label="adjusted by a display rule">
                      {" "}
                      *
                    </span>
                  )}
                </span>
                <span
                  className={styles.prodBarCell}
                  {...tp([
                    money(amount(r)),
                    r.name,
                    `${fmtQty(r.quantity)} counted`,
                    ...(isAdjusted(r) ? [partsLabel(r)] : []),
                  ])}
                >
                  <span
                    className={styles.prodBar}
                    style={{ width: `${(amount(r) / max) * 100}%` }}
                  />
                  <span className={styles.prodValue}>{money(amount(r))}</span>
                </span>
                <span className={styles.prodQty}>{fmtQty(r.quantity)}</span>
                <span className={styles.prodShare}>{total ? pct(amount(r) / total) : "—"}</span>
              </div>
            ))}
          </div>
          {rows.length > TOP_PRODUCTS && (
            <button type="button" className={styles.more} onClick={() => setAll(!all)}>
              {all ? "Show top 10" : `Show all ${rows.length}`}
            </button>
          )}
          <p className={styles.muted}>
            {cleaned
              ? "Names capitalised; * renamed or combined for display (values as sold, only counts multiplied). "
              : "Names as they appear on the till. "}
            Item sales add VAT line by line, so together they can be slightly off the sales total
            (about €1 a month).
          </p>
          {rulesErr && (
            <p className={styles.error}>
              Couldn’t load the display rules — has supabase/financials-product-rules.sql been run?
            </p>
          )}
        </>
      )}
    </section>
  );
}
