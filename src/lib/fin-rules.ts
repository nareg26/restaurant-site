/*
 * Applies the "What sold" display rules (supabase/financials-product-rules.sql)
 * to product totals. Display only: values add up exactly as sold; only the
 * count is multiplied. Items that end up with the same name, ignoring case,
 * become one row.
 */

import type { ProductRule, ProductTotal } from "./fin-store";

export type ShownPart = { product: string; quantity: number; multiplier: number };

export type ShownProduct = {
  name: string;
  quantity: number; // Σ quantity × multiplier
  gross: number;
  net: number;
  /** The till items in this row; more than one, or a multiplier, means a rule applied. */
  parts: ShownPart[];
};

const key = (s: string) => s.trim().toLowerCase();

export function applyRules(products: ProductTotal[], rules: ProductRule[]): ShownProduct[] {
  const byProduct = new Map(rules.map((r) => [key(r.product), r]));
  const rows = new Map<string, ShownProduct>();
  for (const p of products) {
    const rule = byProduct.get(key(p.product));
    const name = rule?.show_as.trim() || p.product;
    const multiplier = rule?.multiplier ?? 1;
    const row = rows.get(key(name)) ?? { name, quantity: 0, gross: 0, net: 0, parts: [] };
    row.quantity += p.quantity * multiplier;
    row.gross += p.gross;
    row.net += p.net;
    row.parts.push({ product: p.product, quantity: p.quantity, multiplier });
    rows.set(key(name), row);
  }
  return [...rows.values()];
}

/** Rows as they come from the till, in the same shape. */
export const asSold = (products: ProductTotal[]): ShownProduct[] =>
  products.map((p) => ({
    name: p.product,
    quantity: p.quantity,
    gross: p.gross,
    net: p.net,
    parts: [{ product: p.product, quantity: p.quantity, multiplier: 1 }],
  }));

/** Whether a rule changed a row: merged items, a new name or a multiplier.
    Capitalisation alone doesn't count. */
export const isAdjusted = (row: ShownProduct) =>
  row.parts.length > 1 ||
  row.parts.some((p) => p.multiplier !== 1 || key(p.product) !== key(row.name));

/* Short joining words stay lower-case inside a name ("Kombucha Pera e Maça"). */
const SMALL_WORDS = new Set([
  "e",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "com",
  "em",
  "a",
  "o",
  "and",
  "of",
]);

/** Capitalises each word for display: "pedras limão" → "Pedras Limão". Words
    with digits ("x2", "x6") and the rest of each word are left as they are. */
export const titleCase = (name: string) =>
  name
    .split(/(\s+)/)
    .map((w, i) => {
      if (!w.trim() || /\d/.test(w)) return w;
      if (i > 0 && SMALL_WORDS.has(w.toLocaleLowerCase("pt"))) return w.toLocaleLowerCase("pt");
      return w.charAt(0).toLocaleUpperCase("pt") + w.slice(1);
    })
    .join("");

/** Rows with their names capitalised, for the cleaned list. */
export const tidyNames = (rows: ShownProduct[]): ShownProduct[] =>
  rows.map((r) => ({ ...r, name: titleCase(r.name) }));

/** "Falafel sandwich 448 + sandes x2 59 × 2" */
export const partsLabel = (row: ShownProduct) =>
  row.parts
    .map(
      (p) =>
        `${p.product} ${fmtQty(p.quantity)}${p.multiplier !== 1 ? ` × ${fmtQty(p.multiplier)}` : ""}`,
    )
    .join(" + ");

export const fmtQty = (n: number) => String(Math.round(n * 100) / 100);
