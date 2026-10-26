/*
 * Reads a Portuguese SAF-T (PT 1.04) export in the browser and keeps only
 * what Financials needs: the sales documents (SalesInvoices), their lines
 * and payments. Customer tax numbers are reduced to a yes/no and never leave
 * this module. Working documents (table bills) and the hash chain are
 * ignored.
 *
 * Amounts are signed: credit notes (NC) come out negative, so sums just work.
 */

export type SaftLine = {
  line_no: number;
  product_code: string;
  product: string;
  quantity: number;
  unit: string;
  unit_price: number; // without VAT
  net: number; // CreditAmount − DebitAmount, without VAT
  vat_rate: number;
};

export type SaftPayment = { method: string; amount: number };

/** One receipt as sent to the import route. Its JSON is what gets hashed
    server-side to spot changes, so keep it free of anything volatile. */
export type SaftReceipt = {
  receipt_no: string;
  receipt_type: string;
  day: string; // ISO date
  entered_at: string; // "2026-09-07T11:30:15", local time
  status: string; // N, A (cancelled), F, S
  status_reason: string;
  net: number;
  tax: number;
  gross: number;
  with_tax_no: boolean;
  lines: SaftLine[];
  payments: SaftPayment[];
};

export type SaftFile = {
  fileName: string;
  sha256: string;
  companyNif: string;
  companyName: string;
  periodStart: string;
  periodEnd: string;
  fileCreated: string;
  software: string;
  receipts: SaftReceipt[];
  /** Problems that make the file unsafe to import. */
  errors: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/* Element helpers by local name, so a namespace prefix doesn't matter. */
const kids = (el: Element | undefined, name: string) =>
  el ? Array.from(el.children).filter((c) => c.localName === name) : [];
const kid = (el: Element | undefined, name: string): Element | undefined => kids(el, name)[0];
const txt = (el: Element | undefined, ...path: string[]) => {
  let cur = el;
  for (const p of path) cur = kid(cur, p);
  return cur?.textContent?.trim() ?? "";
};

/** SAF-T files declare their encoding (usually Windows-1252) in the prolog. */
const decode = (bytes: ArrayBuffer) => {
  const head = new TextDecoder("ascii").decode(bytes.slice(0, 200));
  const label = /encoding=["']([^"']+)["']/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
};

const sha256 = async (bytes: ArrayBuffer) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

/** A real customer NIF, not the generic "final consumer" one. */
const isRealTaxNo = (s: string) => /^\d{9}$/.test(s) && s !== "999999990";

export async function parseSaft(file: File, expectedNif: string): Promise<SaftFile> {
  const bytes = await file.arrayBuffer();
  const doc = new DOMParser().parseFromString(decode(bytes), "application/xml");
  const root = doc.documentElement;

  const base: SaftFile = {
    fileName: file.name,
    sha256: await sha256(bytes),
    companyNif: "",
    companyName: "",
    periodStart: "",
    periodEnd: "",
    fileCreated: "",
    software: "",
    receipts: [],
    errors: [],
  };

  if (doc.getElementsByTagName("parsererror").length || root.localName !== "AuditFile") {
    return { ...base, errors: ["This isn’t a SAF-T file (no AuditFile found)."] };
  }

  const header = kid(root, "Header");
  const out: SaftFile = {
    ...base,
    companyNif: txt(header, "TaxRegistrationNumber") || txt(header, "CompanyID"),
    companyName: txt(header, "CompanyName"),
    periodStart: txt(header, "StartDate"),
    periodEnd: txt(header, "EndDate"),
    fileCreated: txt(header, "DateCreated"),
    software: txt(header, "ProductID"),
  };

  if (out.companyNif !== expectedNif) {
    out.errors.push(
      `This file is for company ${out.companyNif || "?"} (${out.companyName}), not ${expectedNif}.`
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.fileCreated)) {
    out.errors.push("The file has no creation date, so it can’t be ordered against other files.");
  }

  // CustomerID → does it carry a real NIF? Only the yes/no is kept.
  const withTaxNo = new Set<string>();
  for (const c of kids(kid(root, "MasterFiles"), "Customer")) {
    if (isRealTaxNo(txt(c, "CustomerTaxID"))) withTaxNo.add(txt(c, "CustomerID"));
  }

  const sales = kid(kid(root, "SourceDocuments"), "SalesInvoices");
  if (!sales) {
    out.errors.push("The file has no sales documents (SalesInvoices).");
    return out;
  }

  let debit = 0;
  let credit = 0;
  for (const inv of kids(sales, "Invoice")) {
    const type = txt(inv, "InvoiceType");
    const sign = type === "NC" ? -1 : 1;
    const status = txt(inv, "DocumentStatus", "InvoiceStatus");
    const totals = kid(inv, "DocumentTotals");

    const lines: SaftLine[] = kids(inv, "Line").map((l) => {
      const cr = num(txt(l, "CreditAmount"));
      const dr = num(txt(l, "DebitAmount"));
      if (status !== "A" && status !== "F") {
        credit += cr;
        debit += dr;
      }
      return {
        line_no: num(txt(l, "LineNumber")),
        product_code: txt(l, "ProductCode"),
        product: txt(l, "ProductDescription") || txt(l, "Description"),
        quantity: num(txt(l, "Quantity")),
        unit: txt(l, "UnitOfMeasure"),
        unit_price: num(txt(l, "UnitPrice")),
        net: round2(cr - dr),
        vat_rate: num(txt(l, "Tax", "TaxPercentage")),
      };
    });

    out.receipts.push({
      receipt_no: txt(inv, "InvoiceNo"),
      receipt_type: type,
      day: txt(inv, "InvoiceDate"),
      entered_at: txt(inv, "SystemEntryDate"),
      status,
      status_reason: txt(inv, "DocumentStatus", "Reason"),
      net: round2(sign * num(txt(totals, "NetTotal"))),
      tax: round2(sign * num(txt(totals, "TaxPayable"))),
      gross: round2(sign * num(txt(totals, "GrossTotal"))),
      with_tax_no: withTaxNo.has(txt(inv, "CustomerID")),
      lines,
      payments: kids(totals, "Payment").map((p) => ({
        method: txt(p, "PaymentMechanism"),
        amount: round2(sign * num(txt(p, "PaymentAmount"))),
      })),
    });
  }

  // The file's own control totals: a mismatch means it's damaged or cut short.
  const declared = num(txt(sales, "NumberOfEntries"));
  if (declared !== out.receipts.length) {
    out.errors.push(
      `The file says it has ${declared} sales documents but ${out.receipts.length} were found.`
    );
  }
  const checks: [string, number, number][] = [
    ["credit", num(txt(sales, "TotalCredit")), credit],
    ["debit", num(txt(sales, "TotalDebit")), debit],
  ];
  for (const [label, want, got] of checks) {
    if (Math.abs(want - got) > 0.005) {
      out.errors.push(
        `The file’s total ${label} is ${want.toFixed(2)} but its lines add up to ${got.toFixed(2)}.`
      );
    }
  }
  const bad = out.receipts.find(
    (r) => !r.receipt_no || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || !r.entered_at
  );
  if (bad) out.errors.push(`A receipt is missing its number or dates (${bad.receipt_no || "?"}).`);

  return out;
}

/** Summary of the receipts in a parsed file, cancelled ones left out. */
export function summarize(receipts: SaftReceipt[]) {
  const live = receipts.filter((r) => r.status !== "A");
  const days = receipts.map((r) => r.day).sort();
  return {
    count: live.length,
    cancelled: receipts.length - live.length,
    gross: round2(live.reduce((s, r) => s + r.gross, 0)),
    firstDay: days[0] ?? "",
    lastDay: days[days.length - 1] ?? "",
  };
}
