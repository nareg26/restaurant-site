/*
 * Storage backends for shift preferences (the `shift_prefs` table).
 *
 * Each browser gets a random anonymous id (kept in localStorage) and owns
 * one row. Without Supabase env vars, responses stay in this browser only.
 */

import type { MarkKind } from "./prefs-config";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const SHARED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export type PrefRow = {
  /** The number handed out to each person — their identity across devices. */
  id: number;
  name: string;
  /** Ideal hours per week. null = they didn't say. */
  hours_per_week: number | null;
  marks: Partial<Record<string, MarkKind>>;
  points: Partial<Record<string, number>>;
  notes: string;
};

/* Everyone's answers as shown on the results tab. IDs are deliberately left
   out: they're the only thing needed to open someone's answers, so they never
   travel to a browser that isn't their owner's. */
export type PublicPrefRow = Omit<PrefRow, "id">;

export interface PrefsStore {
  getMine(id: number): Promise<PrefRow | null>;
  upsert(row: PrefRow): Promise<void>;
  listAll(): Promise<PublicPrefRow[]>;
}

/* ---------- ID handling ---------- */

/** Up to 9 digits, so the value always fits Postgres' int4. */
export const parseId = (raw: string): number | null =>
  /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : null;

/* The last ID used on this device, so people don't retype it every visit.
   It's a convenience only — the ID in the field is what identifies them. */
const LAST_ID_KEY = "shiftprefs-last-id";

export function getLastId(): string {
  try {
    return localStorage.getItem(LAST_ID_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberLastId(id: number) {
  try {
    localStorage.setItem(LAST_ID_KEY, String(id));
  } catch {}
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const normalize = (v: any): PrefRow => ({
  id: Number(v.id),
  name: (v.name ?? "").toString(),
  hours_per_week:
    v.hours_per_week === null || v.hours_per_week === undefined || v.hours_per_week === ""
      ? null
      : Number(v.hours_per_week),
  marks: v.marks && typeof v.marks === "object" ? v.marks : {},
  points: v.points && typeof v.points === "object" ? v.points : {},
  notes: (v.notes ?? "").toString(),
});

const normalizePublic = (v: any): PublicPrefRow => {
  const { id: _id, ...rest } = normalize(v);
  void _id;
  return rest;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- localStorage backend ---------- */

const LOCAL_KEY = "shift-prefs-v1";

const readAll = (): PrefRow[] => {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
    return Array.isArray(arr) ? arr.map(normalize) : [];
  } catch {
    return [];
  }
};

export const localPrefsStore: PrefsStore = {
  async getMine(id) {
    return readAll().find((r) => r.id === id) ?? null;
  },
  async upsert(row) {
    const rest = readAll().filter((r) => r.id !== row.id);
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify([...rest, row]));
    } catch {}
  },
  async listAll() {
    return readAll()
      .sort((a, b) => a.id - b.id)
      .map(normalizePublic);
  },
};

/* ---------- Supabase REST backend ---------- */

const restUrl = SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/shift_prefs";
const headers = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: "Bearer " + SUPABASE_ANON_KEY,
  "Content-Type": "application/json",
};

const check = async (r: Response) => {
  if (!r.ok) throw new Error((await r.text()).slice(0, 300));
  return r;
};

export const remotePrefsStore: PrefsStore = {
  async getMine(id) {
    const r = await check(
      await fetch(
        `${restUrl}?select=id,name,hours_per_week,marks,points,notes&id=eq.${encodeURIComponent(id)}&limit=1`,
        { headers }
      )
    );
    const rows = (await r.json()) as unknown[];
    return rows.length ? normalize(rows[0]) : null;
  },
  async upsert(row) {
    await check(
      await fetch(restUrl, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
      })
    );
  },
  async listAll() {
    // No id in the select, so IDs never reach a browser other than their owner's.
    const r = await check(
      await fetch(`${restUrl}?select=name,hours_per_week,marks,points,notes&order=id.asc`, {
        headers,
      })
    );
    return ((await r.json()) as unknown[]).map(normalizePublic);
  },
};

export const store: PrefsStore = SHARED ? remotePrefsStore : localPrefsStore;
