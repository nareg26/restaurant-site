/*
 * The shifts being voted on in the current round.
 *
 * These used to be hardcoded; they now live in the `pref_slots` table so they
 * can be set up each week from /admin/preferences. Each slot carries a real
 * date, so day headings and the round's date range derive from the data.
 */

import { fromISODate, pad2 } from "./time";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SHARED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export type PrefSlot = {
  id: string;
  day: string; // ISO date, "2026-09-14"
  start_min: number; // minutes since midnight
  end_min: number;
  need: number; // how many people are needed
  note: string;
};

export type NewPrefSlot = Omit<PrefSlot, "id">;

export interface SlotsStore {
  list(): Promise<PrefSlot[]>;
  create(slot: NewPrefSlot): Promise<PrefSlot>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/* ---------- display helpers ---------- */

/** 840 -> "14", 870 -> "14:30" — matches how the shifts were written by hand. */
export const fmtHour = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? String(h) : `${h}:${pad2(m)}`;
};

export const slotLabel = (s: PrefSlot) => `${fmtHour(s.start_min)}–${fmtHour(s.end_min)}h`;

export const slotDur = (s: PrefSlot) => {
  const total = s.end_min - s.start_min;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${pad2(m)}`;
};

export const dayLabel = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });

export const dayShort = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { weekday: "short" });

/** "7–12 Sept" style range across all slots, for the page subtitle. */
export const rangeLabel = (slots: PrefSlot[]) => {
  if (!slots.length) return "";
  const days = [...new Set(slots.map((s) => s.day))].sort();
  const first = fromISODate(days[0]);
  const last = fromISODate(days[days.length - 1]);
  const sameMonth = first.getMonth() === last.getMonth();
  const fmt = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString("en-GB", withMonth ? { day: "numeric", month: "short" } : { day: "numeric" });
  return `${fmt(first, !sameMonth)} – ${fmt(last, true)}`;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const normalize = (v: any): PrefSlot => ({
  id: String(v.id),
  day: String(v.day),
  start_min: Number(v.start_min),
  end_min: Number(v.end_min),
  need: Number(v.need ?? 1),
  note: (v.note ?? "").toString(),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const bySlot = (a: PrefSlot, b: PrefSlot) =>
  a.day.localeCompare(b.day) || a.start_min - b.start_min || a.end_min - b.end_min;

/* ---------- localStorage backend ---------- */

const LOCAL_KEY = "pref-slots-v1";

const readAll = (): PrefSlot[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
};
const writeAll = (slots: PrefSlot[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(slots));
  } catch {}
};

export const localSlotsStore: SlotsStore = {
  async list() {
    return readAll().sort(bySlot);
  },
  async create(slot) {
    const created: PrefSlot = { ...slot, id: crypto.randomUUID() };
    writeAll([...readAll(), created]);
    return created;
  },
  async remove(id) {
    writeAll(readAll().filter((s) => s.id !== id));
  },
  async clear() {
    writeAll([]);
  },
};

/* ---------- Supabase REST backend ---------- */

const restUrl = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/pref_slots";
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
};

const check = async (r: Response) => {
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r;
};

export const remoteSlotsStore: SlotsStore = {
  async list() {
    const r = await check(
      await fetch(`${restUrl}?select=*&order=day.asc,start_min.asc`, { headers })
    );
    return ((await r.json()) as unknown[]).map(normalize);
  },
  async create(slot) {
    const r = await check(
      await fetch(restUrl, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify([slot]),
      })
    );
    return normalize(((await r.json()) as unknown[])[0]);
  },
  async remove(id) {
    await check(
      await fetch(`${restUrl}?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers })
    );
  },
  async clear() {
    // PostgREST needs a filter; this one matches every row.
    await check(await fetch(`${restUrl}?id=not.is.null`, { method: "DELETE", headers }));
  },
};

export const slotsStore: SlotsStore = SHARED ? remoteSlotsStore : localSlotsStore;
