/*
 * Repeat rules for templates, shaped after Google Calendar's "Custom
 * recurrence" dialog, plus the maths that says whether a rule hits a day.
 *
 * A template has no date of its own, so every rule carries a `start` anchor.
 * Days are local ISO strings ("2026-09-14"); weekdays are 0 = Sunday … 6 =
 * Saturday, like Date#getDay().
 */

import { addDays, fromISODate, mondayOf, toISODate } from "./time";

export type Freq = "daily" | "weekly" | "monthly" | "yearly";

export type RepeatEnd =
  | { kind: "never" }
  | { kind: "on"; date: string }
  | { kind: "after"; count: number };

export type RepeatRule = {
  freq: Freq;
  interval: number; // every N days/weeks/months/years, >= 1
  start: string; // anchor day; first possible occurrence
  /** weekly: which weekdays. (Daily rules keep all seven; older rules may carry a subset.) */
  weekdays: number[];
  /** monthly: same day of month as `start`, or the same nth weekday. */
  monthly: "day" | "weekday";
  end: RepeatEnd;
};

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth"];

/* ---------- normalising what comes out of the database ---------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeRule(v: any): RepeatRule | null {
  if (!v || typeof v !== "object" || typeof v.start !== "string") return null;
  const freq: Freq = ["daily", "weekly", "monthly", "yearly"].includes(v.freq) ? v.freq : "daily";
  const weekdays = Array.isArray(v.weekdays)
    ? v.weekdays.map(Number).filter((d: number) => d >= 0 && d <= 6)
    : ALL_DAYS;
  let end: RepeatEnd = { kind: "never" };
  if (v.end?.kind === "on" && typeof v.end.date === "string") end = { kind: "on", date: v.end.date };
  else if (v.end?.kind === "after" && Number(v.end.count) > 0)
    end = { kind: "after", count: Math.floor(Number(v.end.count)) };
  return {
    freq,
    interval: Math.max(1, Math.floor(Number(v.interval) || 1)),
    start: v.start,
    weekdays: weekdays.length ? [...new Set<number>(weekdays)].sort() : ALL_DAYS,
    monthly: v.monthly === "weekday" ? "weekday" : "day",
    end,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- date helpers ---------- */

const utcDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
const daysBetween = (a: Date, b: Date) => Math.round((utcDay(b) - utcDay(a)) / 86400000);
const monthsBetween = (a: Date, b: Date) =>
  (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
const daysInMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** 1 = first such weekday of the month … 5 = fifth. */
export const nthWeekday = (d: Date) => Math.floor((d.getDate() - 1) / 7) + 1;
export const isLastWeekday = (d: Date) => d.getDate() + 7 > daysInMonth(d);
/** Google says "last Friday" rather than "fifth Friday". */
export const usesLast = (d: Date) => nthWeekday(d) === 5 || (nthWeekday(d) === 4 && isLastWeekday(d));

/** Does the rule (ignoring its end condition) hit this day? */
function matchesBase(rule: RepeatRule, day: string): boolean {
  if (day < rule.start) return false;
  const s = fromISODate(rule.start);
  const d = fromISODate(day);
  switch (rule.freq) {
    case "daily":
      return daysBetween(s, d) % rule.interval === 0 && rule.weekdays.includes(d.getDay());
    case "weekly": {
      const weeks = Math.round(daysBetween(mondayOf(s), mondayOf(d)) / 7);
      return weeks % rule.interval === 0 && rule.weekdays.includes(d.getDay());
    }
    case "monthly": {
      if (monthsBetween(s, d) % rule.interval !== 0) return false;
      if (rule.monthly === "day") return d.getDate() === s.getDate();
      if (d.getDay() !== s.getDay()) return false;
      return usesLast(s) ? isLastWeekday(d) : nthWeekday(d) === nthWeekday(s);
    }
    case "yearly":
      return (
        (d.getFullYear() - s.getFullYear()) % rule.interval === 0 &&
        d.getMonth() === s.getMonth() &&
        d.getDate() === s.getDate()
      );
  }
}

const MAX_SCAN_DAYS = 366 * 10;

/** Does the rule produce an occurrence on `day`? */
export function occursOn(rule: RepeatRule, day: string): boolean {
  if (!matchesBase(rule, day)) return false;
  if (rule.end.kind === "on") return day <= rule.end.date;
  if (rule.end.kind === "after") {
    // Count occurrences from the start up to (and including) this day.
    let count = 0;
    let d = fromISODate(rule.start);
    const target = fromISODate(day);
    for (let i = 0; i < MAX_SCAN_DAYS && d <= target; i++) {
      if (matchesBase(rule, toISODate(d))) {
        count++;
        if (count > rule.end.count) return false;
      }
      d = addDays(d, 1);
    }
    return count <= rule.end.count;
  }
  return true;
}

/* ---------- presets (the quick menu) ---------- */

export type PresetKey = "none" | "daily" | "weekday" | "weekly" | "monthly" | "custom";

const base = (start: string): Omit<RepeatRule, "freq"> => ({
  interval: 1,
  start,
  weekdays: ALL_DAYS,
  monthly: "weekday",
  end: { kind: "never" },
});

/** The rule a preset stands for, anchored on `start`. */
export function presetRule(key: PresetKey, start: string): RepeatRule | null {
  const d = fromISODate(start);
  switch (key) {
    case "daily":
      return { ...base(start), freq: "daily" };
    case "weekday":
      return { ...base(start), freq: "weekly", weekdays: WEEKDAYS };
    case "weekly":
      return { ...base(start), freq: "weekly", weekdays: [d.getDay()] };
    case "monthly":
      return { ...base(start), freq: "monthly", monthly: "weekday" };
    default:
      return null;
  }
}

/** Labels for the quick menu, derived from the anchor date like Google's. */
export function presetLabel(key: PresetKey, start: string): string {
  const d = fromISODate(start);
  switch (key) {
    case "none":
      return "Does not repeat";
    case "daily":
      return "Daily";
    case "weekday":
      return "Every weekday (Monday to Friday)";
    case "weekly":
      return `Weekly on ${DAY_LONG[d.getDay()]}`;
    case "monthly":
      return `Monthly on the ${usesLast(d) ? "last" : ORDINAL[nthWeekday(d)]} ${DAY_LONG[d.getDay()]}`;
    case "custom":
      return "Custom…";
  }
}

/** Which preset a rule is, or "custom". */
export function presetOf(rule: RepeatRule | null): PresetKey {
  if (!rule) return "none";
  if (rule.end.kind !== "never" || rule.interval !== 1) return "custom";
  const days = [...rule.weekdays].sort().join(",");
  if (rule.freq === "daily" && days === ALL_DAYS.join(",")) return "daily";
  if (rule.freq === "weekly" && days === WEEKDAYS.join(",")) return "weekday";
  if (rule.freq === "weekly" && rule.weekdays.length === 1 && rule.weekdays[0] === fromISODate(rule.start).getDay())
    return "weekly";
  if (rule.freq === "monthly" && rule.monthly === "weekday") return "monthly";
  return "custom";
}

/* ---------- plain-words summary ---------- */

const fmtDate = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const listDays = (days: number[]) => {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
  const names = sorted.map((d) => DAY_SHORT[d]);
  return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0] ?? "";
};

/** "Every 2 weeks on Tue and Fri, until 31 Dec 2026". */
export function summary(rule: RepeatRule | null): string {
  if (!rule) return "Does not repeat";
  const s = fromISODate(rule.start);
  const n = rule.interval;
  const days = [...rule.weekdays].sort().join(",");
  let text: string;
  switch (rule.freq) {
    case "daily":
      if (days === ALL_DAYS.join(",")) text = n === 1 ? "Every day" : `Every ${n} days`;
      else if (days === WEEKDAYS.join(",") && n === 1) text = "Every weekday";
      else text = n === 1 ? `Every ${listDays(rule.weekdays)}` : `Every ${n} days, on ${listDays(rule.weekdays)}`;
      break;
    case "weekly":
      if (n === 1 && days === ALL_DAYS.join(",")) text = "Every day";
      else if (n === 1 && days === WEEKDAYS.join(",")) text = "Every weekday";
      else text = (n === 1 ? "Weekly" : `Every ${n} weeks`) + ` on ${listDays(rule.weekdays)}`;
      break;
    case "monthly": {
      const when =
        rule.monthly === "day"
          ? `day ${s.getDate()}`
          : `the ${usesLast(s) ? "last" : ORDINAL[nthWeekday(s)]} ${DAY_LONG[s.getDay()]}`;
      text = (n === 1 ? "Monthly" : `Every ${n} months`) + ` on ${when}`;
      break;
    }
    case "yearly":
      text =
        (n === 1 ? "Every year" : `Every ${n} years`) +
        ` on ${s.toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`;
      break;
  }
  if (rule.end.kind === "on") text += `, until ${fmtDate(rule.end.date)}`;
  else if (rule.end.kind === "after")
    text += `, ${rule.end.count} time${rule.end.count === 1 ? "" : "s"}`;
  return text;
}

/* ---------- virtual occurrence ids ---------- */

/** Sidebar/URL id for an occurrence that hasn't become a page yet. */
export const virtualId = (templateId: string, day: string) => `virtual:${templateId}:${day}`;

export function parseVirtualId(id: string | null): { templateId: string; day: string } | null {
  if (!id || !id.startsWith("virtual:")) return null;
  const [, templateId, day] = id.split(":");
  return templateId && day ? { templateId, day } : null;
}
