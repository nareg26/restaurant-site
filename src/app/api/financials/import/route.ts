/*
 * The only way to write Financials data. The browser parses the SAF-T file
 * and posts receipts here in batches; this route checks the upload PIN and
 * calls fin_import_batch with the secret key (see supabase/financials.sql).
 *
 * Server-only env vars (Netlify + .env.local, never NEXT_PUBLIC_):
 *   SUPABASE_SECRET_KEY  Supabase secret / service_role key
 *   FINANCIALS_PIN       the upload PIN
 *
 * Actions: "check" (PIN only), "preview" (no PIN, writes nothing),
 * "start" → { id }, "batch", "finish".
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { COMPANY_NIF } from "@/lib/fin-store";

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const SECRET = process.env.SUPABASE_SECRET_KEY ?? "";
const PIN = process.env.FINANCIALS_PIN ?? "";

const MAX_BATCH = 500;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const fail = (status: number, error: string) => Response.json({ error }, { status });

const sbHeaders = (): Record<string, string> => ({
  apikey: SECRET,
  "Content-Type": "application/json",
  // Legacy service_role keys are JWTs and go in Authorization too; the newer
  // sb_secret_… keys must not.
  ...(SECRET.startsWith("eyJ") ? { Authorization: "Bearer " + SECRET } : {}),
});

const pinOk = (pin: unknown) => {
  if (typeof pin !== "string" || !PIN) return false;
  const a = createHash("sha256").update(pin).digest();
  const b = createHash("sha256").update(PIN).digest();
  return timingSafeEqual(a, b);
};

async function sb(path: string, init: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(), ...(init.headers as Record<string, string>) },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const validMeta = (f: any) =>
  f &&
  f.company_nif === COMPANY_NIF &&
  typeof f.file_name === "string" &&
  typeof f.file_sha256 === "string" &&
  ISO_DAY.test(f.period_start) &&
  ISO_DAY.test(f.period_end) &&
  ISO_DAY.test(f.file_created) &&
  Number.isInteger(f.receipts_in_file);

const validReceipts = (r: any) =>
  Array.isArray(r) && r.length > 0 && r.length <= MAX_BATCH && r.every((x) => x && x.receipt_no);

export async function POST(request: Request) {
  if (!SUPABASE_URL || !SECRET || !PIN) {
    return fail(503, "Imports aren’t set up on the server (SUPABASE_SECRET_KEY / FINANCIALS_PIN).");
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Bad request.");
  }

  const { action } = body ?? {};
  if (action !== "preview" && !pinOk(body.pin)) {
    await new Promise((r) => setTimeout(r, 600)); // slows down guessing
    return fail(401, "Wrong PIN.");
  }

  try {
    switch (action) {
      case "check":
        return Response.json({ ok: true });

      case "preview": {
        if (!validMeta(body.file) || !validReceipts(body.receipts)) return fail(400, "Bad file data.");
        const result = await sb("rpc/fin_import_batch", {
          method: "POST",
          body: JSON.stringify({
            p_company: body.file.company_nif,
            p_source_created: body.file.file_created,
            p_receipts: body.receipts,
          }),
        });
        return Response.json(result);
      }

      case "start": {
        if (!validMeta(body.file)) return fail(400, "Bad file data.");
        const f = body.file;
        const [row] = await sb("fin_imports", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            file_name: f.file_name.slice(0, 300),
            file_sha256: f.file_sha256,
            company_nif: f.company_nif,
            period_start: f.period_start,
            period_end: f.period_end,
            file_created: f.file_created,
            software: String(f.software ?? "").slice(0, 200),
            receipts_in_file: f.receipts_in_file,
          }),
        });
        return Response.json({ id: row.id });
      }

      case "batch": {
        if (typeof body.importId !== "string" || !validReceipts(body.receipts)) {
          return fail(400, "Bad batch.");
        }
        const result = await sb("rpc/fin_import_batch", {
          method: "POST",
          body: JSON.stringify({
            p_company: COMPANY_NIF,
            p_source_created: null,
            p_receipts: body.receipts,
            p_import_id: body.importId,
          }),
        });
        return Response.json(result);
      }

      case "finish": {
        if (typeof body.importId !== "string") return fail(400, "Bad request.");
        await sb(`fin_imports?id=eq.${encodeURIComponent(body.importId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ status: body.ok ? "done" : "failed" }),
        });
        return Response.json({ ok: true });
      }

      default:
        return fail(400, "Unknown action.");
    }
  } catch (e) {
    console.error(e);
    return fail(502, e instanceof Error ? e.message : "Import failed.");
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
