"use client";

import React, { useEffect, useState } from "react";
import {
  dailyTotals,
  hourlyTotals,
  productTotals,
  type DailyTotal,
  type FinImport,
  type HourTotal,
  type ProductTotal,
} from "@/lib/fin-store";
import {
  daysBetween,
  monthPeriod,
  periodLabel,
  previousLabel,
  shiftPeriod,
  weekPeriod,
  type Period,
  type PeriodMode,
} from "@/lib/fin-period";
import { fromISODate, mondayOf, toISODate } from "@/lib/time";
import WhatSold from "./WhatSold";
import styles from "./dashboard.module.css";

/* ---------- formatting ---------- */

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const eur0 = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const money = (n: number) => eur.format(n);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const dayLabel = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });

/* Payment method codes from SAF-T; everything else is "Other". */
const CARD = "MB";
const CASH = "NU";
const otherPayments = (p: Record<string, number>) =>
  Object.entries(p).reduce((s, [k, v]) => (k === CARD || k === CASH ? s : s + v), 0);

/** Lunch is everything before this hour; dinner from it on. */
const DINNER_FROM = 16;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const weekdayIdx = (iso: string) => (fromISODate(iso).getDay() + 6) % 7;

/* ---------- tooltip ---------- */

type Tip = { x: number; y: number; lines: string[] } | null;
type ShowTip = (e: React.PointerEvent | React.FocusEvent, lines: string[]) => void;

/** Hover and focus handlers for one mark. The tooltip enhances; every value
    is also in the table or written on the chart. */
const tipProps = (show: ShowTip, hide: () => void, lines: string[]) => ({
  tabIndex: 0,
  onPointerMove: (e: React.PointerEvent) => show(e, lines),
  onPointerLeave: hide,
  onFocus: (e: React.FocusEvent) => show(e, lines),
  onBlur: hide,
});

/* ---------- data ---------- */

type Data = {
  key: string;
  days: DailyTotal[];
  prevDays: DailyTotal[];
  hours: HourTotal[];
  products: ProductTotal[];
};

const sumDays = (days: DailyTotal[], vat: boolean) => {
  const t = days.reduce(
    (a, d) => ({
      sales: a.sales + (vat ? d.gross : d.net),
      receipts: a.receipts + d.receipts,
      open: a.open + (d.receipts > 0 ? 1 : 0),
    }),
    { sales: 0, receipts: 0, open: 0 },
  );
  return {
    ...t,
    avgReceipt: t.receipts ? t.sales / t.receipts : 0,
    perDay: t.open ? t.sales / t.open : 0,
  };
};

/** Days in the period with no sales and no imported file covering them. */
const missingDays = (p: Period, days: DailyTotal[], imports: FinImport[]) => {
  const withSales = new Set(days.map((d) => d.day));
  return daysBetween(p.from, p.to).filter(
    (day) =>
      !withSales.has(day) &&
      !imports.some((i) => i.status === "done" && i.period_start <= day && day <= i.period_end),
  );
};

/* ---------- component ---------- */

export default function Dashboard({
  latestDay,
  imports,
  refreshKey,
}: {
  latestDay: string;
  imports: FinImport[];
  refreshKey: number;
}) {
  const [period, setPeriod] = useState<Period>(() => monthPeriod(latestDay));
  const [vat, setVat] = useState(true);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [tip, setTip] = useState<Tip>(null);

  const key = `${period.from}|${period.to}|${refreshKey}`;
  const prev = shiftPeriod(period, -1);

  useEffect(() => {
    let live = true;
    Promise.all([
      dailyTotals(period.from, period.to),
      dailyTotals(prev.from, prev.to),
      hourlyTotals(period.from, period.to),
      productTotals(period.from, period.to),
    ])
      .then(([days, prevDays, hours, products]) => {
        if (!live) return;
        setData({ key, days, prevDays, hours, products });
        setError("");
      })
      .catch((e) => {
        console.error(e);
        if (live) setError("Couldn’t load — has supabase/financials-dashboard.sql been run?");
      });
    return () => {
      live = false;
    };
    // prev is derived from period
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const showTip: ShowTip = (e, lines) => {
    if ("clientX" in e) {
      setTip({ x: e.clientX, y: e.clientY, lines });
    } else {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, lines });
    }
  };
  const hideTip = () => setTip(null);
  const tp = (lines: string[]) => tipProps(showTip, hideTip, lines);

  const setMode = (mode: PeriodMode) => {
    if (mode === "month") setPeriod(monthPeriod(period.from));
    else if (mode === "week") {
      // the last week with sales, rather than a week that isn't imported yet
      const lastSale = data?.days.filter((d) => d.receipts > 0).at(-1)?.day;
      setPeriod(weekPeriod(lastSale ?? period.from));
    } else setPeriod({ ...period, mode: "range" });
  };

  const filters = (
    <div className={styles.filters}>
      <div className={styles.segmented} role="group" aria-label="Period">
        {(["month", "week", "range"] as PeriodMode[]).map((m) => (
          <button key={m} type="button" aria-pressed={period.mode === m} onClick={() => setMode(m)}>
            {m === "month" ? "Month" : m === "week" ? "Week" : "Dates"}
          </button>
        ))}
      </div>
      {period.mode === "range" ? (
        <div className={styles.range}>
          <input
            type="date"
            value={period.from}
            max={period.to}
            onChange={(e) => e.target.value && setPeriod({ ...period, from: e.target.value })}
            aria-label="From"
          />
          <span>–</span>
          <input
            type="date"
            value={period.to}
            min={period.from}
            onChange={(e) => e.target.value && setPeriod({ ...period, to: e.target.value })}
            aria-label="To"
          />
        </div>
      ) : (
        <div className={styles.stepper}>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => setPeriod(shiftPeriod(period, -1))}
          >
            ‹
          </button>
          <span className={styles.periodName}>{periodLabel(period)}</span>
          <button type="button" aria-label="Next" onClick={() => setPeriod(shiftPeriod(period, 1))}>
            ›
          </button>
        </div>
      )}
      <div className={`${styles.segmented} ${styles.vat}`} role="group" aria-label="VAT">
        <button type="button" aria-pressed={vat} onClick={() => setVat(true)}>
          With VAT
        </button>
        <button type="button" aria-pressed={!vat} onClick={() => setVat(false)}>
          Without VAT
        </button>
      </div>
    </div>
  );

  if (!data) {
    return (
      <>
        {filters}
        <p className={styles.muted}>{error || "Loading…"}</p>
      </>
    );
  }

  const loading = data.key !== key;
  const { days, prevDays, hours, products } = data;
  const amount = (d: { gross: number; net: number }) => (vat ? d.gross : d.net);
  const now = sumDays(days, vat);
  const before = sumDays(prevDays, vat);
  const hasPrev = before.receipts > 0;
  // Totals only compare fairly when both periods are fully imported;
  // averages compare either way.
  const totalsComparable =
    hasPrev &&
    missingDays(period, days, imports).length === 0 &&
    missingDays(prev, prevDays, imports).length === 0;

  return (
    <>
      {filters}
      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.body} data-loading={loading || undefined}>
        {/* ---------- headline ---------- */}
        <section className={styles.headline}>
          <div className={styles.hero}>
            <span className={styles.statLabel}>Sales{vat ? "" : " without VAT"}</span>
            <span className={styles.heroValue}>{money(now.sales)}</span>
            <Delta
              now={now.sales}
              before={before.sales}
              show={totalsComparable}
              label={previousLabel(period)}
            />
            {hasPrev && !totalsComparable && (
              <span className={styles.statNote}>
                No change shown: not every day of this or the previous period is imported.
              </span>
            )}
          </div>
          <Stat
            label="Receipts"
            value={String(now.receipts)}
            delta={<Delta now={now.receipts} before={before.receipts} show={totalsComparable} />}
          />
          <Stat
            label="Average receipt"
            value={money(now.avgReceipt)}
            delta={<Delta now={now.avgReceipt} before={before.avgReceipt} show={hasPrev} />}
          />
          <Stat
            label="Sales per open day"
            value={money(now.perDay)}
            note={`${now.open} open ${now.open === 1 ? "day" : "days"}`}
            delta={<Delta now={now.perDay} before={before.perDay} show={hasPrev} />}
          />
        </section>

        {now.receipts === 0 ? (
          <section className={styles.card}>
            <p className={styles.muted}>No sales imported for {periodLabel(period)}.</p>
          </section>
        ) : (
          <>
            <DailyBars period={period} days={days} amount={amount} tp={tp} />

            <div className={styles.twoCol}>
              <Heatmap hours={hours} days={days} amount={amount} vat={vat} tp={tp} />
              <div className={styles.stack}>
                <Split
                  title="Lunch and dinner"
                  parts={splitShifts(hours, amount)}
                  note={`Lunch is before ${DINNER_FROM}h. Receipts logged the next morning count as 21h.`}
                />
                <Split
                  title="How people paid"
                  parts={splitPayments(days)}
                  note="Payments include VAT."
                />
              </div>
            </div>

            <WhatSold
              products={products}

              amount={amount}

              periodName={periodLabel(period)}

              tp={tp}
            />
          </>
        )}

        <Coverage period={period} days={days} imports={imports} tp={tp} />

        <DailyTable period={period} days={days} />
      </div>

      {tip && (
        <div className={styles.tip} style={{ left: tip.x, top: tip.y }} role="status">
          {tip.lines.map((l, i) => (
            <div key={i} className={i === 0 ? styles.tipValue : undefined}>
              {l}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- headline pieces ---------- */

function Stat({
  label,
  value,
  note,
  delta,
}: {
  label: string;
  value: string;
  note?: string;
  delta?: React.ReactNode;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {delta}
      {note && <span className={styles.statNote}>{note}</span>}
    </div>
  );
}

function Delta({
  now,
  before,
  show,
  label,
}: {
  now: number;
  before: number;
  show: boolean;
  label?: string;
}) {
  if (!show || !before) return null;
  const change = (now - before) / before;
  const dir = Math.abs(change) < 0.005 ? "flat" : change > 0 ? "up" : "down";
  return (
    <span className={styles.delta} data-dir={dir}>
      {dir === "up" ? "▲" : dir === "down" ? "▼" : "●"} {change > 0 ? "+" : ""}
      {Math.round(change * 100)}%{label && <span className={styles.deltaLabel}> {label}</span>}
    </span>
  );
}

/* ---------- daily bars ---------- */

/** A clean axis top at or above `max` whose half is also a round number. */
const niceMax = (max: number) => {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 3, 4, 5, 6, 8, 10].map((m) => m * p).find((v) => v >= max) ?? 10 * p;
};

type Bucket = {
  key: string;
  label: string;
  tick: string;
  value: number;
  receipts: number;
  open: boolean;
};

function DailyBars({
  period,
  days,
  amount,
  tp,
}: {
  period: Period;
  days: DailyTotal[];
  amount: (d: DailyTotal) => number;
  tp: (lines: string[]) => object;
}) {
  const byDay = new Map(days.map((d) => [d.day, d]));
  const all = daysBetween(period.from, period.to);
  const weekly = all.length > 62;

  let buckets: Bucket[];
  if (!weekly) {
    buckets = all.map((day) => {
      const d = byDay.get(day);
      const isMon = weekdayIdx(day) === 0;
      return {
        key: day,
        label: dayLabel(day),
        tick: isMon || all.length <= 14 ? String(fromISODate(day).getDate()) : "",
        value: d ? amount(d) : 0,
        receipts: d?.receipts ?? 0,
        open: !!d && d.receipts > 0,
      };
    });
  } else {
    const weeks = new Map<string, Bucket>();
    for (const day of all) {
      const wk = toISODate(mondayOf(fromISODate(day)));
      const b = weeks.get(wk) ?? {
        key: wk,
        label: `Week of ${dayLabel(wk)}`,
        tick:
          fromISODate(wk).getDate() <= 7
            ? fromISODate(wk).toLocaleDateString("en-GB", { month: "short" })
            : "",
        value: 0,
        receipts: 0,
        open: false,
      };
      const d = byDay.get(day);
      if (d) {
        b.value += amount(d);
        b.receipts += d.receipts;
        b.open = b.open || d.receipts > 0;
      }
      weeks.set(wk, b);
    }
    buckets = [...weeks.values()];
  }

  const top = niceMax(Math.max(...buckets.map((b) => b.value)));
  const best = buckets.reduce((a, b) => (b.value > a.value ? b : a), buckets[0]);
  const ticks = [top, top / 2, 0];

  return (
    <section className={styles.card}>
      <h2>{weekly ? "Sales per week" : "Sales per day"}</h2>
      <div className={styles.bars}>
        <div className={styles.yAxis} aria-hidden>
          {ticks.map((t) => (
            <span key={t} style={{ bottom: `${(t / top) * 100}%` }}>
              {eur0.format(t)}
            </span>
          ))}
        </div>
        <div className={styles.plot}>
          {ticks.map((t) => (
            <div key={t} className={styles.grid} style={{ bottom: `${(t / top) * 100}%` }} />
          ))}
          {buckets.map((b) => (
            <div
              key={b.key}
              className={styles.col}
              aria-label={`${b.label}: ${b.open ? money(b.value) : "closed"}`}
              {...tp(
                b.open
                  ? [money(b.value), b.label, `${b.receipts} receipts`]
                  : [weekly ? "No sales" : "Closed", b.label],
              )}
            >
              {b.open && (
                <div className={styles.bar} style={{ height: `${(b.value / top) * 100}%` }}>
                  {b === best && <span className={styles.barLabel}>{eur0.format(b.value)}</span>}
                </div>
              )}
              <span className={styles.tick}>{b.tick}</span>
            </div>
          ))}
        </div>
      </div>
      <p className={styles.muted}>
        {weekly ? "Weeks start on Monday." : "Gaps are days without sales. Dates mark Mondays."}
      </p>
    </section>
  );
}

/* ---------- heatmap ---------- */

function Heatmap({
  hours,
  days,
  amount,
  vat,
  tp,
}: {
  hours: HourTotal[];
  days: DailyTotal[];
  amount: (d: { gross: number; net: number }) => number;
  vat: boolean;
  tp: (lines: string[]) => object;
}) {
  // Open days per weekday, so each cell is an average, not a total that
  // depends on how many Mondays the period happened to have.
  const openDays = Array(7).fill(0);
  for (const d of days) if (d.receipts > 0) openDays[weekdayIdx(d.day)]++;

  const hourList = hours.map((h) => h.hour);
  const first = Math.min(...hourList);
  const last = Math.max(...hourList);
  const cols = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  // Sales and receipts per weekday and hour, summed over the period.
  const sales = Array.from({ length: 7 }, () => new Map<number, number>());
  const receipts = Array.from({ length: 7 }, () => new Map<number, number>());
  for (const h of hours) {
    const w = weekdayIdx(h.day);
    sales[w].set(h.hour, (sales[w].get(h.hour) ?? 0) + amount(h));
    receipts[w].set(h.hour, (receipts[w].get(h.hour) ?? 0) + h.receipts);
  }
  const avg = (sums: Map<number, number>[], w: number, hour: number) =>
    openDays[w] ? (sums[w].get(hour) ?? 0) / openDays[w] : 0;
  const max = Math.max(...WEEKDAYS.flatMap((_, w) => cols.map((c) => avg(sales, w, c))));
  const step = (v: number) => (v <= 0 ? 0 : Math.min(4, Math.ceil((v / max) * 4)));
  // Whole euros in the cells (they're narrow on phones); cents in the tooltip.
  const fmtCell = (v: number) => (v <= 0 ? "" : String(Math.round(v)));

  return (
    <section className={styles.card}>
      <h2>Sales per hour</h2>
      <p className={styles.sub}>
        Average € {vat ? "with" : "without"} VAT on an open day of that weekday.
      </p>
      <div className={styles.heatWrap}>
        <div
          className={styles.heat}
          style={{ gridTemplateColumns: `2.1rem repeat(${cols.length}, minmax(1.2rem, 1fr))` }}
        >
          <span />
          {cols.map((c) => (
            <span key={c} className={styles.heatHour}>
              {c}
            </span>
          ))}
          {WEEKDAYS.map((name, w) => (
            <React.Fragment key={name}>
              <span className={styles.heatDay}>{name}</span>
              {cols.map((c) => {
                const v = avg(sales, w, c);
                return (
                  <span
                    key={c}
                    className={styles.cell}
                    data-step={step(v)}
                    {...tp(
                      openDays[w]
                        ? [
                            money(v),
                            `${name} ${c}:00–${c + 1}:00`,
                            `${avg(receipts, w, c).toFixed(1)} receipts`,
                            openDays[w] === 1
                              ? `on 1 ${WEEKDAYS_LONG[w]}`
                              : `over ${openDays[w]} ${WEEKDAYS_LONG[w]}s`,
                          ]
                        : ["Closed", `No ${WEEKDAYS_LONG[w]}s with sales`],
                    )}
                  >
                    {fmtCell(v)}
                  </span>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className={styles.scale} aria-hidden>
        <span>Less</span>
        {[1, 2, 3, 4].map((s) => (
          <span key={s} className={styles.cell} data-step={s} />
        ))}
        <span>More</span>
      </div>
    </section>
  );
}

/* ---------- splits ---------- */

type Part = { name: string; value: number; detail: string };

function splitShifts(
  hours: HourTotal[],
  amount: (d: { gross: number; net: number }) => number,
): Part[] {
  const part = (name: string, rows: HourTotal[]) => {
    const value = rows.reduce((s, h) => s + amount(h), 0);
    const receipts = rows.reduce((s, h) => s + h.receipts, 0);
    return {
      name,
      value,
      detail: `${receipts} receipts · ${money(receipts ? value / receipts : 0)} average`,
    };
  };
  return [
    part(
      "Lunch",
      hours.filter((h) => h.hour < DINNER_FROM),
    ),
    part(
      "Dinner",
      hours.filter((h) => h.hour >= DINNER_FROM),
    ),
  ];
}

function splitPayments(days: DailyTotal[]): Part[] {
  const sum = (f: (d: DailyTotal) => number) => days.reduce((s, d) => s + f(d), 0);
  const parts = [
    { name: "Card", value: sum((d) => d.payments[CARD] ?? 0), detail: "" },
    { name: "Cash", value: sum((d) => d.payments[CASH] ?? 0), detail: "" },
    { name: "Other", value: sum((d) => otherPayments(d.payments)), detail: "" },
  ];
  return parts.filter((p) => p.name !== "Other" || p.value !== 0);
}

function Split({ title, parts, note }: { title: string; parts: Part[]; note: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      <div className={styles.split}>
        {parts.map((p) => (
          <div key={p.name} className={styles.splitPart}>
            <span className={styles.statLabel}>{p.name}</span>
            <span className={styles.statValue}>{total ? pct(p.value / total) : "—"}</span>
            <span className={styles.statNote}>{money(p.value)}</span>
            {p.detail && <span className={styles.statNote}>{p.detail}</span>}
          </div>
        ))}
      </div>
      <p className={styles.muted}>{note}</p>
    </section>
  );
}

/* ---------- coverage calendar ---------- */

function Coverage({
  period,
  days,
  imports,
  tp,
}: {
  period: Period;
  days: DailyTotal[];
  imports: FinImport[];
  tp: (lines: string[]) => object;
}) {
  const sales = new Map(days.map((d) => [d.day, d]));
  const notIn = new Set(missingDays(period, days, imports));
  const covered = (day: string) => !notIn.has(day);

  const all = daysBetween(period.from, period.to);
  const months = [...new Set(all.map((d) => d.slice(0, 7)))];
  const missing = notIn.size;

  return (
    <section className={styles.card}>
      <h2>
        Which days are in
        <span className={styles.count}>
          {missing ? `${missing} ${missing === 1 ? "day" : "days"} not imported` : "all imported"}
        </span>
      </h2>
      <div className={styles.months}>
        {months.map((ym) => {
          const inMonth = all.filter((d) => d.startsWith(ym));
          const lead = weekdayIdx(inMonth[0]);
          return (
            <div key={ym} className={styles.month}>
              {months.length > 1 && (
                <div className={styles.monthName}>
                  {fromISODate(ym + "-01").toLocaleDateString("en-GB", {
                    month: "long",
                    year: "numeric",
                  })}
                </div>
              )}
              <div className={styles.calendar}>
                {WEEKDAYS.map((w) => (
                  <span key={w} className={styles.calHead}>
                    {w[0]}
                  </span>
                ))}
                {Array.from({ length: lead }, (_, i) => (
                  <span key={"lead" + i} />
                ))}
                {inMonth.map((day) => {
                  const d = sales.get(day);
                  const state = d && d.receipts > 0 ? "sales" : covered(day) ? "closed" : "missing";
                  return (
                    <span
                      key={day}
                      className={styles.calDay}
                      data-state={state}
                      {...tp(
                        state === "sales"
                          ? [money(d!.gross), dayLabel(day), `${d!.receipts} receipts`]
                          : [state === "closed" ? "Closed" : "Not imported yet", dayLabel(day)],
                      )}
                    >
                      {fromISODate(day).getDate()}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className={styles.legend}>
        <span>
          <i data-state="sales" /> Sales
        </span>
        <span>
          <i data-state="closed" /> Closed (in a file, no sales)
        </span>
        <span>
          <i data-state="missing" /> Not imported yet
        </span>
      </div>
    </section>
  );
}

/* ---------- daily table ---------- */

function DailyTable({ period, days }: { period: Period; days: DailyTotal[] }) {
  const total = days.reduce(
    (t, d) => ({
      receipts: t.receipts + d.receipts,
      gross: t.gross + d.gross,
      net: t.net + d.net,
      tax: t.tax + d.tax,
      card: t.card + (d.payments[CARD] ?? 0),
      cash: t.cash + (d.payments[CASH] ?? 0),
      other: t.other + otherPayments(d.payments),
      cancelled: t.cancelled + d.cancelled,
    }),
    { receipts: 0, gross: 0, net: 0, tax: 0, card: 0, cash: 0, other: 0, cancelled: 0 },
  );

  return (
    <section className={styles.card}>
      <h2>Day by day</h2>
      {days.length === 0 ? (
        <p className={styles.muted}>No sales in this period.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Day</th>
                <th>Receipts</th>
                <th>Sales</th>
                <th>Without VAT</th>
                <th>VAT</th>
                <th>Card</th>
                <th>Cash</th>
                <th>Other</th>
                <th>Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <td>{dayLabel(d.day)}</td>
                  <td>{d.receipts}</td>
                  <td>{money(d.gross)}</td>
                  <td>{money(d.net)}</td>
                  <td>{money(d.tax)}</td>
                  <td>{money(d.payments[CARD] ?? 0)}</td>
                  <td>{money(d.payments[CASH] ?? 0)}</td>
                  <td>{otherPayments(d.payments) ? money(otherPayments(d.payments)) : "—"}</td>
                  <td>{d.cancelled || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>{periodLabel(period)}</td>
                <td>{total.receipts}</td>
                <td>{money(total.gross)}</td>
                <td>{money(total.net)}</td>
                <td>{money(total.tax)}</td>
                <td>{money(total.card)}</td>
                <td>{money(total.cash)}</td>
                <td>{total.other ? money(total.other) : "—"}</td>
                <td>{total.cancelled || "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className={styles.muted}>
        Sales include VAT. Cancelled receipts are left out of every column. Receipts logged before
        11h count for the day before.
      </p>
    </section>
  );
}
