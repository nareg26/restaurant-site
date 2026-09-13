/*
 * Recipe helpers: ingredient rows, the scale factor, and the [[ing:id|name]]
 * tokens that mark ingredient pills inside block text.
 *
 * A page keeps the amounts it copied from the template and a single
 * `recipe_scale`; every displayed amount is amount × scale. Rebasing on a row
 * just sets scale = newAmount / row.amount, so precision never drifts.
 */

import type { RecipeRow } from "./tasks-store";

export const TOKEN_RE = /\[\[ing:([^|\]]+)\|([^\]]*)\]\]/g;

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "ing"; id: string; name: string; token: string };

/** Split block text into plain runs and ingredient tokens. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    out.push({ kind: "ing", id: m[1], name: m[2], token: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

export const makeToken = (row: RecipeRow) => `[[ing:${row.id}|${row.name}]]`;

export const newRowId = () => crypto.randomUUID().slice(0, 8);

export const newRow = (): RecipeRow => ({ id: newRowId(), amount: 0, unit: "", name: "" });

/** Up to two decimals, trailing zeros trimmed: 170, 212.5, 8.53. */
export function fmtAmount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 100) / 100;
  return String(r === 0 ? 0 : r);
}

/** "300 g flour" for the current scale; just the name if the row is gone. */
export function pillLabel(
  seg: { id: string; name: string },
  rows: RecipeRow[],
  scale: number
): { label: string; missing: boolean } {
  const row = rows.find((r) => r.id === seg.id);
  if (!row) return { label: seg.name, missing: true };
  const label = [fmtAmount(row.amount * scale), row.unit.trim(), row.name.trim()]
    .filter(Boolean)
    .join(" ");
  return { label, missing: false };
}

/** Parse what someone typed into an amount field. null = not a number (yet). */
export function parseAmount(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
