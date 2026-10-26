/*
 * The period the Financials dashboard shows: a month, a Monday–Sunday week
 * or a custom range, and the period of the same length just before it (what
 * the headline numbers compare against). Days are ISO strings, inclusive.
 */

import { addDays, fromISODate, mondayOf, toISODate } from "./time";

export type PeriodMode = "month" | "week" | "range";
export type Period = { mode: PeriodMode; from: string; to: string };

const lastOfMonth = (ym: string) => {
  const d = fromISODate(ym + "-01");
  return toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
};

export const monthPeriod = (day: string): Period => {
  const ym = day.slice(0, 7);
  return { mode: "month", from: ym + "-01", to: lastOfMonth(ym) };
};

export const weekPeriod = (day: string): Period => {
  const mon = mondayOf(fromISODate(day));
  return { mode: "week", from: toISODate(mon), to: toISODate(addDays(mon, 6)) };
};

/** Every day from `from` to `to`, inclusive. */
export const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = fromISODate(from); toISODate(d) <= to; d = addDays(d, 1)) out.push(toISODate(d));
  return out;
};

const length = (p: Period) => daysBetween(p.from, p.to).length;

/** The period before (dir −1) or after (+1) this one, same kind and length. */
export const shiftPeriod = (p: Period, dir: 1 | -1): Period => {
  if (p.mode === "month") {
    const d = fromISODate(p.from);
    return monthPeriod(toISODate(new Date(d.getFullYear(), d.getMonth() + dir, 1)));
  }
  const n = p.mode === "week" ? 7 : length(p);
  return {
    mode: p.mode,
    from: toISODate(addDays(fromISODate(p.from), dir * n)),
    to: toISODate(addDays(fromISODate(p.to), dir * n)),
  };
};

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  fromISODate(iso).toLocaleDateString("en-GB", opts);

export const periodLabel = (p: Period) => {
  if (p.mode === "month") return fmt(p.from, { month: "long", year: "numeric" });
  const sameMonth = p.from.slice(0, 7) === p.to.slice(0, 7);
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  const start = sameMonth
    ? fmt(p.from, { day: "numeric" })
    : fmt(p.from, sameYear ? { day: "numeric", month: "short" } : { dateStyle: "medium" });
  return `${start} – ${fmt(p.to, { day: "numeric", month: "short", year: "numeric" })}`;
};

/** How the comparison period is named next to a change, e.g. "vs August". */
export const previousLabel = (p: Period) => {
  if (p.mode === "month") return "vs " + fmt(shiftPeriod(p, -1).from, { month: "long" });
  if (p.mode === "week") return "vs the week before";
  return `vs the ${length(p)} days before`;
};
