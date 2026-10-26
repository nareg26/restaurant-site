/*
 * Data access for Financials (/admin/financials). Schema and the rules for
 * which file wins: supabase/financials.sql.
 *
 * Reads go straight to Supabase with the anon key (the tables are public to
 * read). Writes can't: they go through /api/financials/import, which checks
 * the upload PIN and uses the secret key.
 */

import type { SaftFile, SaftReceipt } from "./saft-parse";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SHARED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Sésamo's company (Sabores de Harmonia). Files for any other NIF are refused. */
export const COMPANY_NIF = "519300122";

/** Receipts per request to the import route; keeps each SQL call short. */
const BATCH = 250;
/** Supabase's default cap on rows per response. */
const PAGE = 1000;

const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
};

/* ---------- types ---------- */

export type FinImport = {
  id: string;
  file_name: string;
  file_sha256: string;
  period_start: string;
  period_end: string;
  file_created: string;
  software: string;
  receipts_in_file: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped_older: number;
  status: "running" | "done" | "failed";
  imported_at: string;
};

export type DailyTotal = {
  day: string;
  receipts: number;
  gross: number;
  net: number;
  tax: number;
  cancelled: number;
  /** Payment method code → amount (MB card, NU cash, …). */
  payments: Record<string, number>;
};

export type BatchResult = {
  new: number;
  changed: number;
  unchanged: number;
  older: number;
  changed_receipts: string[];
  older_receipts: string[];
};

const emptyResult = (): BatchResult => ({
  new: 0,
  changed: 0,
  unchanged: 0,
  older: 0,
  changed_receipts: [],
  older_receipts: [],
});

const addResult = (a: BatchResult, b: BatchResult): BatchResult => ({
  new: a.new + b.new,
  changed: a.changed + b.changed,
  unchanged: a.unchanged + b.unchanged,
  older: a.older + b.older,
  changed_receipts: [...a.changed_receipts, ...b.changed_receipts],
  older_receipts: [...a.older_receipts, ...b.older_receipts],
});

/* ---------- reads ---------- */

/** Every row of a query, fetched a page at a time. */
async function getAll<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=${PAGE}&offset=${offset}`, {
      headers,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

const company = `company_nif=eq.${COMPANY_NIF}`;

export async function listImports(): Promise<FinImport[]> {
  return getAll<FinImport>(`fin_imports?select=*&${company}&order=imported_at.desc`);
}

/** The months ("2026-09") that have any receipts, newest first. */
export async function listMonths(): Promise<string[]> {
  const rows = await getAll<{ day: string }>(`fin_daily?select=day&${company}&order=day.desc`);
  return [...new Set(rows.map((r) => r.day.slice(0, 7)))];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function dailyTotals(fromDay: string, toDay: string): Promise<DailyTotal[]> {
  const range = `${company}&day=gte.${fromDay}&day=lte.${toDay}&order=day`;
  const [days, pays] = await Promise.all([
    getAll<any>(`fin_daily?select=*&${range}`),
    getAll<any>(`fin_daily_payments?select=*&${range}`),
  ]);
  const byDay = new Map<string, DailyTotal>(
    days.map((d) => [
      d.day,
      {
        day: d.day,
        receipts: Number(d.receipts),
        gross: Number(d.gross),
        net: Number(d.net),
        tax: Number(d.tax),
        cancelled: Number(d.cancelled),
        payments: {},
      },
    ])
  );
  for (const p of pays) {
    const d = byDay.get(p.day);
    if (d) d.payments[p.method] = (d.payments[p.method] ?? 0) + Number(p.amount);
  }
  return [...byDay.values()];
}

export type HourTotal = { day: string; hour: number; receipts: number; gross: number; net: number };

/** Receipts and sales per working day and hour (late receipts shown at 21h). */
export async function hourlyTotals(fromDay: string, toDay: string): Promise<HourTotal[]> {
  const rows = await getAll<any>(
    `fin_hourly?select=day,hour,receipts,gross,net&${company}&day=gte.${fromDay}&day=lte.${toDay}&order=day,hour`
  );
  return rows.map((r) => ({
    day: r.day,
    hour: Number(r.hour),
    receipts: Number(r.receipts),
    gross: Number(r.gross),
    net: Number(r.net),
  }));
}

export type ProductTotal = { product: string; quantity: number; gross: number; net: number };

/** What sold in the range, duplicate names merged, best sellers first. */
export async function productTotals(fromDay: string, toDay: string): Promise<ProductTotal[]> {
  const rows = await getAll<any>(
    `fin_product_daily?select=product,quantity,gross,net&${company}&day=gte.${fromDay}&day=lte.${toDay}`
  );
  const byName = new Map<string, ProductTotal>();
  for (const r of rows) {
    const p = byName.get(r.product) ?? { product: r.product, quantity: 0, gross: 0, net: 0 };
    p.quantity += Number(r.quantity);
    p.gross += Number(r.gross);
    p.net += Number(r.net);
    byName.set(r.product, p);
  }
  return [...byName.values()].sort((a, b) => b.gross - a.gross);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- import (via the server route) ---------- */

async function call<T>(body: object): Promise<T> {
  const res = await fetch("/api/financials/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Import failed (${res.status})`);
  return data as T;
}

const fileMeta = (f: SaftFile) => ({
  file_name: f.fileName,
  file_sha256: f.sha256,
  company_nif: f.companyNif,
  period_start: f.periodStart,
  period_end: f.periodEnd,
  file_created: f.fileCreated,
  software: f.software,
  receipts_in_file: f.receipts.length,
});

const batches = (receipts: SaftReceipt[]) =>
  Array.from({ length: Math.ceil(receipts.length / BATCH) }, (_, i) =>
    receipts.slice(i * BATCH, (i + 1) * BATCH)
  );

/** What importing would do, without writing anything. */
export async function previewImport(f: SaftFile): Promise<BatchResult> {
  let total = emptyResult();
  for (const receipts of batches(f.receipts)) {
    const r = await call<BatchResult>({ action: "preview", file: fileMeta(f), receipts });
    total = addResult(total, r);
  }
  return total;
}

export async function checkPin(pin: string): Promise<void> {
  await call({ action: "check", pin });
}

export async function runImport(
  f: SaftFile,
  pin: string,
  onProgress: (done: number, total: number) => void
): Promise<BatchResult> {
  const { id } = await call<{ id: string }>({ action: "start", pin, file: fileMeta(f) });
  let total = emptyResult();
  let done = 0;
  try {
    for (const receipts of batches(f.receipts)) {
      const r = await call<BatchResult>({ action: "batch", pin, importId: id, receipts });
      total = addResult(total, r);
      done += receipts.length;
      onProgress(done, f.receipts.length);
    }
  } catch (e) {
    await call({ action: "finish", pin, importId: id, ok: false }).catch(() => {});
    throw e;
  }
  await call({ action: "finish", pin, importId: id, ok: true });
  return total;
}
