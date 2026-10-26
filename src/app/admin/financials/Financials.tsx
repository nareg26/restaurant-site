"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  COMPANY_NIF,
  SHARED,
  listImports,
  listMonths,
  previewImport,
  runImport,
  type BatchResult,
  type FinImport,
} from "@/lib/fin-store";
import { parseSaft, summarize, type SaftFile } from "@/lib/saft-parse";
import { fromISODate } from "@/lib/time";
import Dashboard from "./Dashboard";
import styles from "./financials.module.css";

type Status = { kind: "" | "ok" | "busy" | "err"; msg: string };

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const money = (n: number) => eur.format(n);

const dateLabel = (iso: string) =>
  fromISODate(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export default function Financials() {
  const [imports, setImports] = useState<FinImport[] | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
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
      setRefreshKey((k) => k + 1);
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
      setFileStatus({
        kind: "err",
        msg: e instanceof Error ? e.message : "Couldn’t read the file.",
      });
    }
  };

  const doImport = async () => {
    if (!file || !preview) return;
    setImportStatus({ kind: "busy", msg: "Importing…" });
    try {
      const r = await runImport(file, pin, (done, total) =>
        setImportStatus({ kind: "busy", msg: `Importing… ${done} of ${total}` }),
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

        {months.length > 0 && imports && (
          <Dashboard latestDay={months[0] + "-01"} imports={imports} refreshKey={refreshKey} />
        )}
        {imports !== null && months.length === 0 && !loadErr && (
          <p className={styles.muted}>Nothing imported yet — start with a SAF-T file below.</p>
        )}

        <details className={styles.data} open={imports !== null && months.length === 0}>
          <summary>Import files and see what’s been imported</summary>

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
              Export it from WinRest for any date range. Overlapping files are fine: receipts
              already imported are recognised, and a newer export replaces an older one, never the
              reverse.
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
                          {plural(preview.older, "receipt")} skipped: this file is older than the
                          one they came from
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
        </details>
      </div>
    </div>
  );
}
