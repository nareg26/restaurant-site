"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  COMPANY_NIF,
  SHARED,
  dailyTotals,
  listImports,
  listMonths,
  previewImport,
  runImport,
  type BatchResult,
  type DailyTotal,
  type FinImport,
} from "@/lib/fin-store";
import { parseSaft, summarize, type SaftFile } from "@/lib/saft-parse";
import { fromISODate } from "@/lib/time";
import styles from "./financials.module.css";

type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const money = (n: number) => eur.format(n);

const dayLabel = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const dateLabel = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const monthLabel = (ym: string) =>
  fromISODate(ym + "-01").toLocaleDateString("en-GB", { month: "long", year: "numeric" });
const lastOfMonth = (ym: string) => {
  const d = fromISODate(ym + "-01");
  return `${ym}-${new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()}`;
};

/* Payment method codes from SAF-T; everything else is "Other". */
const CARD = "MB";
const CASH = "NU";
const otherPayments = (p: Record<string, number>) =>
  Object.entries(p).reduce((s, [k, v]) => (k === CARD || k === CASH ? s : s + v), 0);

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export default function Financials() {
  const [imports, setImports] = useState<FinImport[] | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [month, setMonth] = useState("");
  const [days, setDays] = useState<DailyTotal[] | null>(null);
  const [loadErr, setLoadErr] = useState("");

  const [file, setFile] = useState<SaftFile | null>(null);
  const [preview, setPreview] = useState<BatchResult | null>(null);
  const [fileStatus, setFileStatus] = useState<Status>({ kind: "", msg: "" });
  const [pin, setPin] = useState("");
  const [importStatus, setImportStatus] = useState<Status>({ kind: "", msg: "" });
  const [inputKey, setInputKey] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [list, ms] = await Promise.all([listImports(), listMonths()]);
      setImports(list);
      setMonths(ms);
      setMonth((m) => (m && ms.includes(m) ? m : (ms[0] ?? "")));
      setLoadErr("");
    } catch (e) {
      console.error(e);
      setImports([]);
      setLoadErr("Couldn’t load — has supabase/financials.sql been run?");
    }
  }, []);

  useEffect(() => {
    // refresh only sets state after its fetches resolve, not synchronously
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (SHARED) refresh();
  }, [refresh]);

  useEffect(() => {
    if (!month) return;
    let live = true;
    dailyTotals(month + "-01", lastOfMonth(month))
      .then((d) => live && setDays(d))
      .catch((e) => {
        console.error(e);
        if (live) setDays([]);
      });
    return () => {
      live = false;
    };
  }, [month, imports]);

  const chooseFile = async (f: File | undefined) => {
    setFile(null);
    setPreview(null);
    setImportStatus({ kind: "", msg: "" });
    if (!f) return;
    setFileStatus({ kind: "busy", msg: "Reading the file…" });
    try {
      const parsed = await parseSaft(f, COMPANY_NIF);
      setFile(parsed);
      if (parsed.errors.length) {
        setFileStatus({ kind: "err", msg: "This file can’t be imported." });
        return;
      }
      setFileStatus({ kind: "busy", msg: "Comparing with what’s already imported…" });
      setPreview(await previewImport(parsed));
      setFileStatus({ kind: "", msg: "" });
    } catch (e) {
      console.error(e);
      setFileStatus({ kind: "err", msg: e instanceof Error ? e.message : "Couldn’t read the file." });
    }
  };

  const doImport = async () => {
    if (!file || !preview) return;
    setImportStatus({ kind: "busy", msg: "Importing…" });
    try {
      const r = await runImport(file, pin, (done, total) =>
        setImportStatus({ kind: "busy", msg: `Importing… ${done} of ${total}` })
      );
      setImportStatus({
        kind: "ok",
        msg:
          `Imported: ${r.new} new, ${r.changed} changed, ${r.unchanged} already there` +
          (r.older ? `, ${r.older} skipped (older file)` : "") +
          ".",
      });
      setFile(null);
      setPreview(null);
      setInputKey((k) => k + 1);
      await refresh();
    } catch (e) {
      console.error(e);
      setImportStatus({ kind: "err", msg: e instanceof Error ? e.message : "Import failed." });
    }
  };

  const sum = file ? summarize(file.receipts) : null;
  const sameFile = file && imports ? imports.filter((i) => i.file_sha256 === file.sha256) : [];
  const toWrite = preview ? preview.new + preview.changed : 0;
  const busy = importStatus.kind === "busy";
  const canImport = !!preview && toWrite > 0 && pin.length > 0 && !busy;

  const total = (days ?? []).reduce(
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
    { receipts: 0, gross: 0, net: 0, tax: 0, card: 0, cash: 0, other: 0, cancelled: 0 }
  );

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <header className={styles.header}>
          <h1>Financials</h1>
          <p>
            Sales from the till’s SAF-T exports. Anyone can see these numbers; importing needs the
            upload PIN. Customer tax numbers are never stored.
          </p>
        </header>

        {!SHARED && (
          <div className={styles.banner}>
            <b>Not connected to Supabase.</b> Financials needs the Supabase settings in{" "}
            <code>.env.local</code>.
          </div>
        )}
        {loadErr && <div className={styles.banner}>{loadErr}</div>}

        <section className={styles.card}>
          <h2>Import a SAF-T file</h2>
          <label className={styles.filePick}>
            <input
              key={inputKey}
              type="file"
              accept=".xml,text/xml,application/xml"
              onChange={(e) => chooseFile(e.target.files?.[0])}
              disabled={!SHARED || busy}
            />
          </label>
          <p className={styles.muted}>
            Export it from WinRest for any date range. Overlapping files are fine: receipts already
            imported are recognised, and a newer export replaces an older one, never the reverse.
          </p>

          {fileStatus.msg && (
            <p className={styles.status} data-kind={fileStatus.kind}>
              {fileStatus.msg}
            </p>
          )}

          {file && file.errors.length > 0 && (
            <ul className={styles.errors}>
              {file.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {file && sum && file.errors.length === 0 && (
            <div className={styles.fileInfo}>
              <dl className={styles.facts}>
                <dt>Company</dt>
                <dd>{file.companyName}</dd>
                <dt>Period</dt>
                <dd>
                  {dateLabel(file.periodStart)} – {dateLabel(file.periodEnd)}
                </dd>
                <dt>Created</dt>
                <dd>{dateLabel(file.fileCreated)}</dd>
                <dt>Sales</dt>
                <dd>
                  {money(sum.gross)} from {plural(sum.count, "receipt")}
                  {sum.cancelled > 0 && <> ({sum.cancelled} cancelled, not counted)</>}
                </dd>
              </dl>

              {sameFile.length > 0 && (
                <p className={styles.warn}>
                  This exact file was already imported on{" "}
                  {new Date(sameFile[0].imported_at).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  .
                </p>
              )}

              {preview && (
                <>
                  <div className={styles.previewRow}>
                    <span className={styles.chip} data-kind="new">
                      {preview.new} new
                    </span>
                    <span className={styles.chip} data-kind="changed">
                      {preview.changed} changed
                    </span>
                    <span className={styles.chip}>{preview.unchanged} already there</span>
                    {preview.older > 0 && (
                      <span className={styles.chip} data-kind="older">
                        {preview.older} skipped
                      </span>
                    )}
                  </div>
                  {preview.changed > 0 && (
                    <details className={styles.details}>
                      <summary>Changed receipts</summary>
                      <p>{preview.changed_receipts.join(", ")}</p>
                    </details>
                  )}
                  {preview.older > 0 && (
                    <details className={styles.details}>
                      <summary>
                        {plural(preview.older, "receipt")} skipped: this file is older than the one
                        they came from
                      </summary>
                      <p>{preview.older_receipts.join(", ")}</p>
                    </details>
                  )}
                  {toWrite === 0 ? (
                    <p className={styles.muted}>Nothing new in this file.</p>
                  ) : (
                    <form
                      className={styles.actions}
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (canImport) doImport();
                      }}
                    >
                      <label className={styles.pinField}>
                        Upload PIN
                        <input
                          type="password"
                          autoComplete="off"
                          value={pin}
                          onChange={(e) => setPin(e.target.value)}
                        />
                      </label>
                      <button type="submit" className={styles.primary} disabled={!canImport}>
                        Import {plural(toWrite, "receipt")}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}

          {importStatus.msg && (
            <p className={styles.status} data-kind={importStatus.kind}>
              {importStatus.msg}
            </p>
          )}
        </section>

        <section className={styles.card}>
          <h2>
            Totals
            {months.length > 0 && (
              <select
                className={styles.monthPick}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            )}
          </h2>
          {imports !== null && months.length === 0 && (
            <p className={styles.muted}>Nothing imported yet.</p>
          )}
          {month && days && (
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
                    <td>{monthLabel(month)}</td>
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
            Sales include VAT. Cancelled receipts are left out of every column.
          </p>
        </section>

        <section className={styles.card}>
          <h2>
            Imports
            {imports && imports.length > 0 && (
              <span className={styles.count}>{plural(imports.length, "file")}</span>
            )}
          </h2>
          {imports === null && SHARED && <p className={styles.muted}>Loading…</p>}
          {imports?.length === 0 && <p className={styles.muted}>No files imported yet.</p>}
          {imports?.map((i) => (
            <div key={i.id} className={styles.importRow}>
              <div className={styles.importName}>
                {i.file_name}
                {i.status !== "done" && (
                  <span className={styles.badge}>
                    {i.status === "failed" ? "failed" : "incomplete"}
                  </span>
                )}
              </div>
              <div className={styles.importMeta}>
                {dateLabel(i.period_start)} – {dateLabel(i.period_end)} · created{" "}
                {dateLabel(i.file_created)} · imported{" "}
                {new Date(i.imported_at).toLocaleString("en-GB", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              <div className={styles.importMeta}>
                {plural(i.receipts_in_file, "receipt")}: {i.inserted} new, {i.updated} changed,{" "}
                {i.unchanged} already there
                {i.skipped_older > 0 && <>, {i.skipped_older} skipped (older file)</>}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
