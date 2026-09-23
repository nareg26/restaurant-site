/* Small date/time helpers. Days are ISO strings ("2026-08-03") in local time;
 * times-of-day are minutes since midnight (540 = 9:00). */

export const pad2 = (n: number) => String(n).padStart(2, "0");

export const toISODate = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const fromISODate = (iso: string) => new Date(iso + "T00:00:00");

export const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

/** The kitchen's day runs until 3:00, so a closing shift past midnight still
 *  belongs to the day it started. */
export const DAY_START_HOUR = 3;

/** The working day `now` falls in, as an ISO date. */
export const workDayISO = (now: Date = new Date()) => {
  const d = new Date(now);
  d.setHours(d.getHours() - DAY_START_HOUR);
  return toISODate(d);
};

/** Monday 00:00 of the week containing d. */
export const mondayOf = (d: Date) => {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  c.setDate(c.getDate() - ((c.getDay() + 6) % 7));
  return c;
};

export const fmtMin = (m: number) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;

export const parseTime = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};
