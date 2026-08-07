import { useMemo, useState, type ReactNode } from "react";
import { CalendarDays, Download } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { PAYMENT_TYPE_LABELS } from "@/pages/Payments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — reports.
 * Ten tabular reports behind reports.view. Date-ranged where it makes
 * sense, with a totals strip above every table and CSV export behind
 * reports.export (generated client-side from the same rows you see).
 */

type Range = { dateFrom?: string; dateTo?: string };

const REPORTS = [
  { id: "sales", label: "Sales" },
  { id: "products", label: "Product sales" },
  { id: "reps", label: "Sales by rep" },
  { id: "payments", label: "Payments" },
  { id: "money", label: "Money movements" },
  { id: "expenses", label: "Expenses" },
  { id: "profit", label: "Profit & loss" },
  { id: "credit", label: "Credit" },
  { id: "deposits", label: "Deposits" },
  { id: "inventory", label: "Inventory" },
  { id: "movements", label: "Stock movements" },
  { id: "returns", label: "Returns" },
  { id: "exchanges", label: "Exchanges" },
  { id: "payroll", label: "Payroll" },
  { id: "loans", label: "Staff loans" },
] as const;
type ReportId = (typeof REPORTS)[number]["id"];

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
] as const;

function presetRange(id: string): Range {
  const now = new Date();
  if (id === "all") return {};
  if (id === "month") return { dateFrom: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: ymd(now) };
  const days = id === "7d" ? 7 : id === "90d" ? 90 : 30;
  return { dateFrom: ymd(new Date(now.getTime() - (days - 1) * 86400000)), dateTo: ymd(now) };
}

/* --------------------------------- EXPORT --------------------------------- */

interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const esc = (v: string | number | null | undefined) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => esc(c.value(row))).join(","));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast.success(`Downloaded ${filename}`);
}

/* ------------------------------- SHARED BITS ------------------------------ */

function RangeBar({
  range,
  onChange,
  children,
}: {
  range: Range;
  onChange: (r: Range, preset: string) => void;
  children?: ReactNode;
}) {
  const [preset, setPreset] = useState<string>("30d");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg bg-[#22264B]/5 p-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setPreset(p.id);
              onChange(presetRange(p.id), p.id);
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              preset === p.id ? "bg-[#22264B] text-white shadow-sm" : "text-[#22264B]/60 hover:text-[#22264B]"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <CalendarDays className="size-4 text-[#22264B]/40" />
        <Input
          type="date"
          value={range.dateFrom ?? ""}
          onChange={(e) => {
            setPreset("custom");
            onChange({ ...range, dateFrom: e.target.value || undefined }, "custom");
          }}
          className="h-8 w-[150px] bg-white text-xs"
        />
        <span className="text-xs text-[#22264B]/40">to</span>
        <Input
          type="date"
          value={range.dateTo ?? ""}
          onChange={(e) => {
            setPreset("custom");
            onChange({ ...range, dateTo: e.target.value || undefined }, "custom");
          }}
          className="h-8 w-[150px] bg-white text-xs"
        />
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[#22264B]/10 bg-white px-4 py-3">
      <p className="text-[10px] font-bold tracking-[0.14em] text-[#22264B]/45 uppercase">{label}</p>
      <p className="mt-1 text-lg font-extrabold text-[#22264B]">{value}</p>
      {hint && <p className="text-[11px] text-[#22264B]/50">{hint}</p>}
    </div>
  );
}

function ReportTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#22264B]/10 bg-white">
      <Table>
        <TableHeader>
          <TableRow className="bg-[#22264B]/[0.03]">
            {head.map((h) => (
              <TableHead key={h} className="text-[11px] font-bold tracking-wide text-[#22264B]/60 uppercase">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>{children}</TableBody>
      </Table>
    </div>
  );
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return (
    <TableRow>
      <TableCell colSpan={cols} className="py-10 text-center text-sm text-[#22264B]/40">
        {text}
      </TableCell>
    </TableRow>
  );
}

function ExportButton<T>({
  filename,
  columns,
  rows,
}: {
  filename: string;
  columns: CsvColumn<T>[];
  rows: T[] | undefined;
}) {
  const { hasPermission } = useAuth();
  if (!hasPermission("reports.export")) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!rows || rows.length === 0}
      onClick={() => rows && downloadCsv(filename, columns, rows)}
      className="gap-1.5"
    >
      <Download className="size-3.5" /> Export CSV
    </Button>
  );
}

function LoadingGrid() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full bg-[#22264B]/5" />
      ))}
    </div>
  );
}

const PAY_STATUS_STYLES: Record<string, string> = {
  PAID: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  PARTIAL: "border-amber-600/30 bg-amber-50 text-amber-700",
  UNPAID: "border-red-600/30 bg-red-50 text-red-700",
  OVERPAID: "border-sky-600/30 bg-sky-50 text-sky-700",
};

const MODE_LABELS: Record<string, string> = {
  PAY_LATER: "Pay later",
  CREDIT: "Credit",
  DEPOSIT: "Deposit",
};

/* ------------------------------ SALES REPORT ------------------------------ */

function SalesReport({ range }: { range: Range }) {
  const [status, setStatus] = useState<"ALL" | "COMPLETED" | "CANCELLED" | "OPEN">("COMPLETED");
  const q = trpc.reports.salesReport.useQuery({ ...range, status });
  const rows = q.data?.items;

  const cols: CsvColumn<(typeof rows extends (infer T)[] | undefined ? T : never)>[] = [
    { header: "Order no", value: (r) => r.orderNo },
    { header: "Date", value: (r) => formatDateTime(r.createdAt) },
    { header: "Customer", value: (r) => r.customerName },
    { header: "Rep", value: (r) => r.repName },
    { header: "Status", value: (r) => r.status },
    { header: "Payment", value: (r) => r.paymentStatus },
    { header: "Mode", value: (r) => MODE_LABELS[r.paymentMode] ?? r.paymentMode },
    { header: "Subtotal", value: (r) => r.subtotal },
    { header: "Discount", value: (r) => r.discountTotal },
    { header: "Grand total", value: (r) => r.grandTotal },
    { header: "Paid", value: (r) => r.amountPaid },
    { header: "Balance", value: (r) => r.balanceDue },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="h-8 w-[170px] bg-white text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="OPEN">Open (in progress)</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
            <SelectItem value="ALL">All statuses</SelectItem>
          </SelectContent>
        </Select>
        <ExportButton filename="sales-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Sales" value={String(q.data?.totals.count ?? 0)} />
            <Stat label="Revenue" value={formatMoney(q.data?.totals.revenue)} />
            <Stat label="Discounts" value={formatMoney(q.data?.totals.discount)} />
            <Stat label="Collected" value={formatMoney(q.data?.totals.collected)} />
            <Stat label="Outstanding" value={formatMoney(q.data?.totals.outstanding)} />
          </div>
          <ReportTable head={["Order", "Date", "Customer", "Rep", "Mode", "Payment", "Total", "Balance"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={8} text="No sales in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.orderNo}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.createdAt)}</TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell className="text-xs">{r.repName}</TableCell>
                  <TableCell className="text-xs">{MODE_LABELS[r.paymentMode]}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={PAY_STATUS_STYLES[r.paymentStatus]}>
                      {r.paymentStatus}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-semibold">{formatMoney(r.grandTotal)}</TableCell>
                  <TableCell className={Number(r.balanceDue) > 0 ? "font-semibold text-red-600" : ""}>
                    {formatMoney(Math.max(0, Number(r.balanceDue)))}
                  </TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* --------------------------- PRODUCT SALES REPORT -------------------------- */

function ProductSalesReport({ range }: { range: Range }) {
  const q = trpc.reports.productSalesReport.useQuery(range);
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Product", value: (r) => r.productName },
    { header: "SKU", value: (r) => r.sku },
    { header: "Packs sold", value: (r) => r.packs },
    { header: "Revenue", value: (r) => r.revenue },
    { header: "Cost", value: (r) => r.cost },
    { header: "Margin", value: (r) => r.margin },
    { header: "Margin %", value: (r) => r.marginPct.toFixed(1) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="product-sales-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Packs sold" value={formatQty(q.data?.totals.packs)} />
            <Stat label="Revenue" value={formatMoney(q.data?.totals.revenue)} />
            <Stat label="Cost of goods" value={formatMoney(q.data?.totals.cost)} />
            <Stat label="Gross margin" value={formatMoney(q.data?.totals.margin)} />
          </div>
          <ReportTable head={["Product", "SKU", "Packs sold", "Revenue", "Cost", "Margin", "Margin %"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={7} text="No completed sales in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.productId}>
                  <TableCell className="font-semibold text-[#22264B]">{r.productName}</TableCell>
                  <TableCell className="text-xs">{r.sku}</TableCell>
                  <TableCell>{formatQty(r.packs)}</TableCell>
                  <TableCell className="font-semibold">{formatMoney(r.revenue)}</TableCell>
                  <TableCell>{formatMoney(r.cost)}</TableCell>
                  <TableCell className="font-semibold text-emerald-700">{formatMoney(r.margin)}</TableCell>
                  <TableCell className="text-xs">{r.marginPct.toFixed(1)}%</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ------------------------------ REP SALES REPORT --------------------------- */

function RepSalesReport({ range }: { range: Range }) {
  const q = trpc.reports.repSalesReport.useQuery(range);
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Rep", value: (r) => r.repName },
    { header: "Sales", value: (r) => r.salesCount },
    { header: "Revenue", value: (r) => r.revenue },
    { header: "Collected", value: (r) => r.collected },
    { header: "Outstanding", value: (r) => r.outstanding },
    { header: "Discounts given", value: (r) => r.discount },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="rep-sales-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Sales" value={String(q.data?.totals.salesCount ?? 0)} />
            <Stat label="Revenue" value={formatMoney(q.data?.totals.revenue)} />
            <Stat label="Collected" value={formatMoney(q.data?.totals.collected)} />
            <Stat label="Outstanding" value={formatMoney(q.data?.totals.outstanding)} />
          </div>
          <ReportTable head={["Sales rep", "Sales", "Revenue", "Collected", "Outstanding", "Discounts"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={6} text="No completed sales in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.repId}>
                  <TableCell className="font-semibold text-[#22264B]">{r.repName}</TableCell>
                  <TableCell>{r.salesCount}</TableCell>
                  <TableCell className="font-semibold">{formatMoney(r.revenue)}</TableCell>
                  <TableCell>{formatMoney(r.collected)}</TableCell>
                  <TableCell className={r.outstanding > 0 ? "font-semibold text-red-600" : ""}>
                    {formatMoney(r.outstanding)}
                  </TableCell>
                  <TableCell className="text-xs">{formatMoney(r.discount)}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}


/* ----------------------------- PAYMENTS REPORT ---------------------------- */

const METHOD_LABELS_FULL: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  POS: "POS",
  CHEQUE: "Cheque",
  DEPOSIT_BALANCE: "Deposit balance",
};

function PaymentsReport({ range }: { range: Range }) {
  const [type, setType] = useState<string>("ALL");
  const [method, setMethod] = useState<string>("ALL");
  const q = trpc.reports.paymentsReport.useQuery({
    ...range,
    paymentType: type as "ALL",
    method: method as "ALL",
  });
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Reference", value: (r) => r.reference },
    { header: "Confirmed", value: (r) => formatDateTime(r.confirmedAt) },
    { header: "Type", value: (r) => PAYMENT_TYPE_LABELS[r.paymentType] },
    { header: "Method", value: (r) => METHOD_LABELS_FULL[r.method] },
    { header: "Customer", value: (r) => r.customerName },
    { header: "Sale", value: (r) => r.orderNo },
    { header: "Amount", value: (r) => r.amount },
    { header: "Applied to sale", value: (r) => r.appliedToSale },
    { header: "To deposit", value: (r) => r.addedToDeposit },
    { header: "External ref", value: (r) => r.externalReference },
    { header: "Recorded by", value: (r) => r.recorderName },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="h-8 w-[170px] bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {Object.entries(PAYMENT_TYPE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-8 w-[150px] bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All methods</SelectItem>
              {Object.entries(METHOD_LABELS_FULL)
                .filter(([k]) => k !== "DEPOSIT_BALANCE")
                .map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <ExportButton filename="payments-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Payments" value={String(q.data?.totals.count ?? 0)} />
            <Stat label="Money in" value={formatMoney(q.data?.totals.moneyIn)} />
            <Stat label="Refunds out" value={formatMoney(q.data?.totals.refunds)} />
            <Stat label="Net collected" value={formatMoney(q.data?.totals.net)} />
          </div>
          {(q.data?.totals.byMethod.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.data!.totals.byMethod.map((m) => (
                <span key={m.method} className="rounded-full bg-[#22264B]/5 px-3 py-1 text-xs font-semibold text-[#22264B]/70">
                  {METHOD_LABELS_FULL[m.method]} · {formatMoney(m.amount)}
                </span>
              ))}
            </div>
          )}
          <ReportTable head={["Reference", "Confirmed", "Type", "Method", "Customer / Sale", "Amount"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={6} text="No confirmed payments in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell className="text-xs">{formatDateTime(r.confirmedAt)}</TableCell>
                  <TableCell className="text-xs">{PAYMENT_TYPE_LABELS[r.paymentType]}</TableCell>
                  <TableCell className="text-xs">{METHOD_LABELS_FULL[r.method]}</TableCell>
                  <TableCell>
                    <span className="block">{r.customerName}</span>
                    {r.orderNo && <span className="text-xs text-[#22264B]/50">{r.orderNo}</span>}
                  </TableCell>
                  <TableCell className={`font-semibold ${r.paymentType === "DEPOSIT_REFUND" ? "text-red-600" : ""}`}>
                    {r.paymentType === "DEPOSIT_REFUND" ? "−" : ""}{formatMoney(r.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ----------------------------- EXPENSES REPORT ---------------------------- */

function ExpensesReport({ range }: { range: Range }) {
  const catsQ = trpc.expenses.categories.useQuery();
  const [categoryId, setCategoryId] = useState<string>("ALL");
  const q = trpc.reports.expensesReport.useQuery({
    ...range,
    categoryId: categoryId === "ALL" ? undefined : Number(categoryId),
  });
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Reference", value: (r) => r.reference },
    { header: "Date", value: (r) => formatDate(r.expenseDate) },
    { header: "Category", value: (r) => r.categoryName },
    { header: "Description", value: (r) => r.description },
    { header: "Vendor", value: (r) => r.vendor },
    { header: "Amount", value: (r) => r.amount },
    { header: "Recorded by", value: (r) => r.creatorName },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-8 w-[190px] bg-white text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {(catsQ.data ?? []).map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ExportButton filename="expenses-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Expenses" value={String(q.data?.totals.count ?? 0)} />
            <Stat label="Total spent" value={formatMoney(q.data?.totals.amount)} />
            <Stat label="Categories used" value={String(q.data?.totals.byCategory.length ?? 0)} />
          </div>
          {(q.data?.totals.byCategory.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2">
              {q.data!.totals.byCategory.map((c) => (
                <span key={c.category} className="rounded-full bg-[#22264B]/5 px-3 py-1 text-xs font-semibold text-[#22264B]/70">
                  {c.category} · {formatMoney(c.amount)}
                </span>
              ))}
            </div>
          )}
          <ReportTable head={["Reference", "Date", "Category", "Description", "Vendor", "Amount"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={6} text="No approved expenses in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.expenseDate)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]">
                      {r.categoryName}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-xs">{r.description}</TableCell>
                  <TableCell className="text-xs">{r.vendor ?? "—"}</TableCell>
                  <TableCell className="font-semibold">{formatMoney(r.amount)}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ------------------------------ PROFIT REPORT ----------------------------- */

function ProfitReport({ range }: { range: Range }) {
  const q = trpc.reports.profitReport.useQuery(range);
  const d = q.data;

  if (q.isLoading) return <LoadingGrid />;
  const pct = (v?: number) => `${(v ?? 0).toFixed(1)}%`;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Completed sales" value={String(d?.salesCount ?? 0)} />
        <Stat label="Revenue" value={formatMoney(d?.revenue)} hint={`Discounts given: ${formatMoney(d?.discount)}`} />
        <Stat label="Gross margin" value={formatMoney(d?.grossMargin)} hint={`${pct(d?.grossMarginPct)} of revenue`} />
        <Stat label="Net margin" value={formatMoney(d?.netMargin)} hint={`${pct(d?.netMarginPct)} of revenue`} />
      </div>
      <div className="mx-auto max-w-xl overflow-hidden rounded-xl border border-[#22264B]/10 bg-white">
        <div className="border-b border-[#22264B]/10 bg-[#22264B]/[0.03] px-5 py-3">
          <h3 className="text-sm font-extrabold text-[#22264B]">Profit & loss statement</h3>
          <p className="text-[11px] text-[#22264B]/50">
            {range.dateFrom ? formatDate(range.dateFrom) : "Beginning"} — {range.dateTo ? formatDate(range.dateTo) : "today"}
          </p>
        </div>
        <div className="divide-y divide-[#22264B]/5 text-sm">
          {[
            { label: "Revenue (completed sales)", value: formatMoney(d?.revenue), bold: false },
            { label: "Cost of goods sold", value: `(${formatMoney(d?.cogs)})`, bold: false },
            { label: "Gross margin", value: formatMoney(d?.grossMargin), bold: true, note: pct(d?.grossMarginPct) },
            { label: "Operating expenses (approved)", value: `(${formatMoney(d?.expenses)})`, bold: false },
            { label: "Net margin", value: formatMoney(d?.netMargin), bold: true, note: pct(d?.netMarginPct) },
          ].map((row) => (
            <div key={row.label} className={`flex items-center justify-between px-5 py-3 ${row.bold ? "bg-[#F7A026]/5" : ""}`}>
              <span className={row.bold ? "font-extrabold text-[#22264B]" : "text-[#22264B]/70"}>{row.label}</span>
              <span className={`flex items-baseline gap-2 ${row.bold ? "font-extrabold text-[#22264B]" : "text-[#22264B]/70"}`}>
                {row.note && <span className="text-[11px] font-semibold text-[#22264B]/40">{row.note}</span>}
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <div className="border-t border-[#22264B]/10 px-5 py-3 text-[11px] text-[#22264B]/50">
          Collected against these sales so far: <span className="font-semibold text-[#22264B]">{formatMoney(d?.collected)}</span>
          {" "}· unpaid balance counts as receivable, not as a loss here.
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ CREDIT REPORT ----------------------------- */

function CreditReport() {
  const q = trpc.reports.creditReport.useQuery();
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Code", value: (r) => r.code },
    { header: "Customer", value: (r) => r.fullName },
    { header: "Phone", value: (r) => r.phone },
    { header: "Credit limit", value: (r) => r.creditLimit },
    { header: "Outstanding", value: (r) => r.creditOutstanding },
    { header: "Headroom", value: (r) => r.headroom },
    { header: "Utilization %", value: (r) => r.utilizationPct?.toFixed(0) ?? "" },
    { header: "Lifetime spend", value: (r) => r.totalSpent },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="credit-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Credit accounts" value={String(q.data?.totals.accounts ?? 0)} />
            <Stat label="Total limits" value={formatMoney(q.data?.totals.limits)} />
            <Stat label="Total outstanding" value={formatMoney(q.data?.totals.outstanding)} />
            <Stat label="Total headroom" value={formatMoney(q.data?.totals.headroom)} />
          </div>
          <ReportTable head={["Customer", "Phone", "Limit", "Outstanding", "Headroom", "Used", "Last sale"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={7} text="No credit accounts yet." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="block font-semibold text-[#22264B]">{r.fullName}</span>
                    <span className="text-xs text-[#22264B]/50">{r.code}</span>
                  </TableCell>
                  <TableCell className="text-xs">{r.phone ?? "—"}</TableCell>
                  <TableCell>{formatMoney(r.creditLimit)}</TableCell>
                  <TableCell className={Number(r.creditOutstanding) > 0 ? "font-semibold text-red-600" : ""}>
                    {formatMoney(r.creditOutstanding)}
                  </TableCell>
                  <TableCell>{formatMoney(r.headroom)}</TableCell>
                  <TableCell className="w-[120px]">
                    {r.utilizationPct != null && (
                      <div className="h-2 overflow-hidden rounded-full bg-[#22264B]/10">
                        <div
                          className={`h-full rounded-full ${r.utilizationPct > 80 ? "bg-red-500" : r.utilizationPct > 50 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, r.utilizationPct)}%` }}
                        />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(r.lastSaleAt)}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ----------------------------- DEPOSITS REPORT ---------------------------- */

function DepositsReport() {
  const q = trpc.reports.depositsReport.useQuery();
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Code", value: (r) => r.code },
    { header: "Customer", value: (r) => r.fullName },
    { header: "Phone", value: (r) => r.phone },
    { header: "Deposit balance", value: (r) => r.depositBalance },
    { header: "Lifetime spend", value: (r) => r.totalSpent },
    { header: "Last sale", value: (r) => formatDate(r.lastSaleAt) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="deposits-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Accounts with deposits" value={String(q.data?.totals.accounts ?? 0)} />
            <Stat label="Money held" value={formatMoney(q.data?.totals.held)} />
            <Stat label="Avg per account" value={formatMoney((q.data?.totals.held ?? 0) / Math.max(1, q.data?.totals.accounts ?? 1))} />
          </div>
          <ReportTable head={["Customer", "Phone", "Deposit balance", "Lifetime spend", "Last sale"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={5} text="Nobody holds a deposit balance right now." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="block font-semibold text-[#22264B]">{r.fullName}</span>
                    <span className="text-xs text-[#22264B]/50">{r.code}</span>
                  </TableCell>
                  <TableCell className="text-xs">{r.phone ?? "—"}</TableCell>
                  <TableCell className="font-semibold text-emerald-700">{formatMoney(r.depositBalance)}</TableCell>
                  <TableCell>{formatMoney(r.totalSpent)}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.lastSaleAt)}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ---------------------------- INVENTORY REPORT ---------------------------- */

function InventoryReport() {
  const q = trpc.reports.inventoryReport.useQuery();
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "SKU", value: (r) => r.sku },
    { header: "Product", value: (r) => r.name },
    { header: "Pack", value: (r) => r.packDescription },
    { header: "Stock (packs)", value: (r) => r.currentStock },
    { header: "Reorder level", value: (r) => r.reorderLevel },
    { header: "Cost / pack", value: (r) => r.costCartonPrice },
    { header: "Sell / pack", value: (r) => r.sellCartonPrice },
    { header: "Cost value", value: (r) => r.costValue },
    { header: "Sell value", value: (r) => r.sellValue },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="inventory-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Products" value={String(q.data?.totals.products ?? 0)} />
            <Stat label="Packs on hand" value={formatQty(q.data?.totals.packs)} />
            <Stat label="Cost value" value={formatMoney(q.data?.totals.costValue)} />
            <Stat label="Sell value" value={formatMoney(q.data?.totals.sellValue)} />
            <Stat label="Low stock" value={String(q.data?.totals.lowStockCount ?? 0)} hint="at/below reorder level" />
          </div>
          <ReportTable head={["Product", "Pack", "Stock", "Cost/pack", "Sell/pack", "Cost value", "Sell value"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={7} text="No active products." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <span className="block font-semibold text-[#22264B]">{r.name}</span>
                    <span className="text-xs text-[#22264B]/50">{r.sku}</span>
                  </TableCell>
                  <TableCell className="text-xs">{r.packDescription}</TableCell>
                  <TableCell>
                    <span className={`font-semibold ${r.lowStock ? "text-red-600" : ""}`}>{formatQty(r.currentStock)}</span>
                    {r.lowStock && <span className="ml-1 text-[10px] font-bold text-red-500 uppercase">low</span>}
                  </TableCell>
                  <TableCell>{formatMoney(r.costCartonPrice)}</TableCell>
                  <TableCell>{formatMoney(r.sellCartonPrice)}</TableCell>
                  <TableCell>{formatMoney(r.costValue)}</TableCell>
                  <TableCell>{formatMoney(r.sellValue)}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* --------------------------- MOVEMENTS REPORT ----------------------------- */

function MovementsReport({ range }: { range: Range }) {
  const q = trpc.reports.movementsReport.useQuery(range);
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Date", value: (r) => formatDateTime(r.createdAt) },
    { header: "Product", value: (r) => r.productName },
    { header: "Type", value: (r) => r.movementType },
    { header: "Qty (packs)", value: (r) => r.quantity },
    { header: "Balance after", value: (r) => r.balanceAfter },
    { header: "Reference", value: (r) => r.referenceType },
    { header: "Reason", value: (r) => r.reason },
    { header: "By", value: (r) => r.performerName },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="stock-movements-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Movements" value={String(q.data?.totals.count ?? 0)} />
            <Stat label="Stock in" value={`+${formatQty(q.data?.totals.stockIn)} packs`} />
            <Stat label="Stock out" value={`−${formatQty(q.data?.totals.stockOut)} packs`} />
          </div>
          <ReportTable head={["Date", "Product", "Type", "Qty", "Balance", "Reason", "By"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={7} text="No stock movements in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{formatDateTime(r.createdAt)}</TableCell>
                  <TableCell className="max-w-[240px] truncate font-semibold text-[#22264B]">{r.productName}</TableCell>
                  <TableCell className="text-xs">{r.movementType.replace(/_/g, " ")}</TableCell>
                  <TableCell className={`font-semibold ${Number(r.quantity) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                    {Number(r.quantity) > 0 ? "+" : ""}{formatQty(r.quantity)}
                  </TableCell>
                  <TableCell className="text-xs">{formatQty(r.balanceAfter)}</TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs">{r.reason ?? r.referenceType ?? "—"}</TableCell>
                  <TableCell className="text-xs">{r.performerName ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ------------------------------ RETURNS REPORT ---------------------------- */

const RETURN_STATUS_STYLES: Record<string, string> = {
  COMPLETED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  PENDING_APPROVAL: "border-amber-600/30 bg-amber-50 text-amber-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
  CANCELLED: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
};

function ReturnsReport({ range }: { range: Range }) {
  const q = trpc.reports.returnsReport.useQuery(range);
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Reference", value: (r) => r.reference },
    { header: "Date", value: (r) => formatDateTime(r.createdAt) },
    { header: "Sale", value: (r) => r.orderNo },
    { header: "Customer", value: (r) => r.customerName },
    { header: "Status", value: (r) => r.status },
    { header: "Items (units)", value: (r) => r.itemQty },
    { header: "Value", value: (r) => r.totalAmount },
    { header: "Restocked", value: (r) => (r.restock ? "Yes" : "No") },
    { header: "Processed by", value: (r) => r.processorName },
    { header: "Reason", value: (r) => r.reason },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="returns-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Returns" value={String(q.data?.totals.count ?? 0)} />
            <Stat label="Completed" value={String(q.data?.totals.completedCount ?? 0)} />
            <Stat label="Pending approval" value={String(q.data?.totals.pendingCount ?? 0)} />
            <Stat label="Items returned" value={formatQty(q.data?.totals.totalQty)} />
            <Stat label="Value credited" value={formatMoney(q.data?.totals.totalValue)} hint="to credit / deposit wallet" />
          </div>
          <ReportTable head={["Reference", "Date", "Sale", "Customer", "Status", "Items", "Value", "Restocked", "By"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={9} text="No returns in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.createdAt)}</TableCell>
                  <TableCell className="text-xs">{r.orderNo}</TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={RETURN_STATUS_STYLES[r.status]}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatQty(r.itemQty)}</TableCell>
                  <TableCell className="font-semibold">{formatMoney(r.totalAmount)}</TableCell>
                  <TableCell className="text-xs">{r.restock ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-xs">{r.processorName}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ----------------------------- EXCHANGES REPORT --------------------------- */

const SETTLEMENT_REPORT_LABELS: Record<string, string> = {
  NONE: "Even swap",
  TOPUP_CASH: "Top-up · Cash",
  TOPUP_TRANSFER: "Top-up · Transfer",
  TOPUP_POS: "Top-up · POS",
  TOPUP_CHEQUE: "Top-up · Cheque",
  TOPUP_DEPOSIT: "Top-up · Deposit",
  TOPUP_CREDIT: "Top-up · Credit",
  TO_DEPOSIT: "Balance → deposit",
};

function ExchangesReport({ range }: { range: Range }) {
  const q = trpc.reports.exchangesReport.useQuery(range);
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Reference", value: (r) => r.reference },
    { header: "Date", value: (r) => formatDateTime(r.createdAt) },
    { header: "Sale", value: (r) => r.orderNo },
    { header: "Customer", value: (r) => r.customerName },
    { header: "Status", value: (r) => r.status },
    { header: "Returned value", value: (r) => r.returnedTotal },
    { header: "New value", value: (r) => r.newTotal },
    { header: "Difference", value: (r) => r.difference },
    { header: "Settlement", value: (r) => SETTLEMENT_REPORT_LABELS[r.settlementType] ?? r.settlementType },
    { header: "Processed by", value: (r) => r.processorName },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="exchanges-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Exchanges" value={String(q.data?.totals.count ?? 0)} hint={`${q.data?.totals.pendingCount ?? 0} pending approval`} />
            <Stat label="Returned value" value={formatMoney(q.data?.totals.returnedValue)} />
            <Stat label="New items value" value={formatMoney(q.data?.totals.newValue)} />
            <Stat label="Top-ups collected" value={formatMoney(q.data?.totals.topupsCollected)} hint={`To deposit wallets: ${formatMoney(q.data?.totals.creditedToDeposits)}`} />
          </div>
          <ReportTable head={["Reference", "Date", "Sale", "Customer", "Status", "Returned", "New", "Difference", "Settlement"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={9} text="No exchanges in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell className="text-xs">{formatDate(r.createdAt)}</TableCell>
                  <TableCell className="text-xs">{r.orderNo}</TableCell>
                  <TableCell>{r.customerName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={RETURN_STATUS_STYLES[r.status]}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatMoney(r.returnedTotal)}</TableCell>
                  <TableCell>{formatMoney(r.newTotal)}</TableCell>
                  <TableCell className={`font-semibold ${Number(r.difference) > 0 ? "text-amber-700" : Number(r.difference) < 0 ? "text-emerald-700" : ""}`}>
                    {Number(r.difference) > 0 ? "+" : ""}{formatMoney(r.difference)}
                  </TableCell>
                  <TableCell className="text-xs">{SETTLEMENT_REPORT_LABELS[r.settlementType] ?? r.settlementType}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ------------------------------ PAYROLL REPORT ---------------------------- */

const SALARY_STATUS_STYLES: Record<string, string> = {
  PAID: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  CANCELLED: "border-red-600/30 bg-red-50 text-red-700",
};

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function PayrollReport() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState("ALL");
  const q = trpc.reports.payrollReport.useQuery({
    year: Number(year),
    month: month === "ALL" ? undefined : Number(month),
  });
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Reference", value: (r) => r.reference },
    { header: "Staff", value: (r) => r.staffName },
    { header: "Period", value: (r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}` },
    { header: "Gross", value: (r) => r.grossPay },
    { header: "Tax", value: (r) => r.taxAmount },
    { header: "Pension", value: (r) => r.pensionAmount },
    { header: "VAT", value: (r) => r.vatAmount },
    { header: "Loan deduction", value: (r) => r.loanDeduction },
    { header: "Other deductions", value: (r) => r.otherDeduction },
    { header: "Net pay", value: (r) => r.netPay },
    { header: "Status", value: (r) => r.status },
    { header: "Method", value: (r) => r.paymentMethod },
    { header: "Payment ref", value: (r) => r.paymentReference },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger className="h-8 w-[110px] bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-[130px] bg-white text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All months</SelectItem>
              {MONTH_NAMES.map((m, i) => (
                <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ExportButton filename="payroll-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Payslips paid" value={String(q.data?.totals.paidCount ?? 0)} hint={`${q.data?.totals.pendingCount ?? 0} pending`} />
            <Stat label="Gross pay" value={formatMoney(q.data?.totals.gross)} />
            <Stat label="Deductions" value={formatMoney((q.data?.totals.tax ?? 0) + (q.data?.totals.pension ?? 0) + (q.data?.totals.vat ?? 0) + (q.data?.totals.loanDeductions ?? 0) + (q.data?.totals.otherDeductions ?? 0))} hint={`Loan recoveries: ${formatMoney(q.data?.totals.loanDeductions)}`} />
            <Stat label="Net paid" value={formatMoney(q.data?.totals.netPaid)} />
          </div>
          <ReportTable head={["Reference", "Staff", "Period", "Gross", "Loan ded.", "Net pay", "Status", "Method"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={8} text="No salary payments for this period." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell>
                    <span className="block font-semibold text-[#22264B]">{r.staffName}</span>
                    <span className="text-xs text-[#22264B]/50">{r.staffCode ?? ""}</span>
                  </TableCell>
                  <TableCell className="text-xs">{MONTH_NAMES[r.periodMonth - 1]} {r.periodYear}</TableCell>
                  <TableCell>{formatMoney(r.grossPay)}</TableCell>
                  <TableCell className="text-xs">{Number(r.loanDeduction) > 0 ? formatMoney(r.loanDeduction) : "—"}</TableCell>
                  <TableCell className="font-semibold">{formatMoney(r.netPay)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={SALARY_STATUS_STYLES[r.status]}>{r.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.paymentMethod ? r.paymentMethod.replace(/_/g, " ") : "—"}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* ------------------------------- LOANS REPORT ----------------------------- */

const LOAN_STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  PAID_OFF: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]",
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
  CANCELLED: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
};

function LoansReport() {
  const q = trpc.reports.loansReport.useQuery();
  const rows = q.data?.items;

  const cols: CsvColumn<NonNullable<typeof rows>[number]>[] = [
    { header: "Reference", value: (r) => r.reference },
    { header: "Staff", value: (r) => r.staffName },
    { header: "Amount", value: (r) => r.amount },
    { header: "Term (months)", value: (r) => r.termMonths },
    { header: "Monthly deduction", value: (r) => r.monthlyDeduction },
    { header: "Repaid", value: (r) => r.amountRepaid },
    { header: "Remaining", value: (r) => r.remainingBalance },
    { header: "Starts", value: (r) => `${r.startYear}-${String(r.startMonth).padStart(2, "0")}` },
    { header: "Status", value: (r) => r.status },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButton filename="staff-loans-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Active loans" value={String(q.data?.totals.activeCount ?? 0)} hint={`${q.data?.totals.count ?? 0} total`} />
            <Stat label="Total disbursed" value={formatMoney(q.data?.totals.disbursed)} />
            <Stat label="Recovered" value={formatMoney(q.data?.totals.recovered)} />
            <Stat label="Outstanding" value={formatMoney(q.data?.totals.outstanding)} />
          </div>
          <ReportTable head={["Reference", "Staff", "Amount", "Monthly", "Repaid", "Remaining", "Starts", "Status"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={8} text="No staff loans yet." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell>
                    <span className="block font-semibold text-[#22264B]">{r.staffName}</span>
                    <span className="text-xs text-[#22264B]/50">{r.staffCode ?? ""}</span>
                  </TableCell>
                  <TableCell>{formatMoney(r.amount)}</TableCell>
                  <TableCell className="text-xs">{formatMoney(r.monthlyDeduction)} × {r.termMonths}</TableCell>
                  <TableCell className="text-emerald-700">{formatMoney(r.amountRepaid)}</TableCell>
                  <TableCell className={Number(r.remainingBalance) > 0 ? "font-semibold text-amber-700" : ""}>
                    {formatMoney(r.remainingBalance)}
                  </TableCell>
                  <TableCell className="text-xs">{MONTH_NAMES[r.startMonth - 1]} {r.startYear}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={LOAN_STATUS_STYLES[r.status]}>
                      {r.status.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* --------------------------- MONEY MOVEMENTS REPORT --------------------------- */

const MONEY_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  POS: "POS",
  CHEQUE: "Cheque",
};
const MONEY_SOURCE_LABELS: Record<string, string> = {
  SALE_PAYMENT: "Sale payments",
  CREDIT_PAYMENT: "Credit repayments",
  ADVANCE_DEPOSIT: "Advance deposits",
  OTHER_IN: "Other income",
  EXPENSE: "Expenses",
  SALARY: "Salaries",
  LOAN: "Staff loans",
  DEPOSIT_REFUND: "Deposit refunds",
  OTHER_OUT: "Other payouts",
};

function MoneyReport({ range }: { range: Range }) {
  const q = trpc.reports.moneyMovementsReport.useQuery(range);
  const rows = q.data?.rows;
  const s = q.data?.summary;

  type Row = NonNullable<typeof rows>[number];
  const cols: CsvColumn<Row>[] = [
    { header: "Date", value: (r) => formatDateTime(r.date) },
    { header: "Reference", value: (r) => r.reference },
    { header: "Direction", value: (r) => r.direction },
    { header: "Source", value: (r) => MONEY_SOURCE_LABELS[r.source] ?? r.source },
    { header: "Method", value: (r) => MONEY_METHOD_LABELS[r.method] ?? r.method },
    { header: "Party", value: (r) => r.party ?? "" },
    { header: "Description", value: (r) => r.description },
    { header: "Amount", value: (r) => r.amount.toFixed(2) },
    { header: "Recorded by", value: (r) => r.recordedBy ?? "" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[#22264B]/50">
          Real money only — credit sales and deposit-wallet usage are excluded.
        </p>
        <ExportButton filename="money-movements-report.csv" columns={cols} rows={rows} />
      </div>
      {q.isLoading ? (
        <LoadingGrid />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Money in" value={formatMoney(s?.totalIn)} />
            <Stat label="Money out" value={formatMoney(s?.totalOut)} />
            <Stat label="Net flow" value={formatMoney(s?.net)} />
            <Stat label="Transactions" value={String(s?.count ?? 0)} />
          </div>

          <ReportTable head={["Method", "In", "Out", "Balance"]}>
            {(s?.methods ?? []).map((m) => (
              <TableRow key={m.method}>
                <TableCell className="font-semibold text-[#22264B]">{MONEY_METHOD_LABELS[m.method]}</TableCell>
                <TableCell className="text-emerald-700">{formatMoney(m.in)}</TableCell>
                <TableCell className="text-red-700">{formatMoney(m.out)}</TableCell>
                <TableCell className={`font-bold ${m.balance >= 0 ? "text-[#22264B]" : "text-red-600"}`}>
                  {formatMoney(m.balance)}
                </TableCell>
              </TableRow>
            ))}
          </ReportTable>

          <ReportTable head={["Source", "Direction", "Total", "Count"]}>
            {(s?.sources ?? []).map((x) => (
              <TableRow key={x.source}>
                <TableCell className="font-semibold text-[#22264B]">{MONEY_SOURCE_LABELS[x.source] ?? x.source}</TableCell>
                <TableCell className={x.direction === "IN" ? "text-emerald-700" : "text-red-700"}>
                  {x.direction === "IN" ? "In" : "Out"}
                </TableCell>
                <TableCell>{formatMoney(x.total)}</TableCell>
                <TableCell>{x.count}</TableCell>
              </TableRow>
            ))}
          </ReportTable>

          <ReportTable head={["Date", "Reference", "Source", "Method", "Party / details", "In", "Out"]}>
            {!rows || rows.length === 0 ? (
              <EmptyRow cols={7} text="No money movements in this range." />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{formatDateTime(r.date)}</TableCell>
                  <TableCell className="font-mono text-xs font-semibold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell className="text-xs">{MONEY_SOURCE_LABELS[r.source] ?? r.source}</TableCell>
                  <TableCell className="text-xs">{MONEY_METHOD_LABELS[r.method] ?? r.method}</TableCell>
                  <TableCell className="max-w-xs">
                    <span className="block truncate text-xs">{r.party ?? "—"}</span>
                    {r.description && <span className="block truncate text-xs text-[#22264B]/45">{r.description}</span>}
                  </TableCell>
                  <TableCell className="text-emerald-700">{r.direction === "IN" ? formatMoney(r.amount) : ""}</TableCell>
                  <TableCell className="text-red-700">{r.direction === "OUT" ? formatMoney(r.amount) : ""}</TableCell>
                </TableRow>
              ))
            )}
          </ReportTable>
        </>
      )}
    </div>
  );
}

/* --------------------------------- SHELL ---------------------------------- */

const RANGED_REPORTS: ReportId[] = ["sales", "products", "reps", "payments", "money", "expenses", "profit", "movements", "returns", "exchanges"];

export default function Reports() {
  const [report, setReport] = useState<ReportId>("sales");
  const [range, setRange] = useState<Range>(() => presetRange("30d"));

  const body = useMemo(() => {
    switch (report) {
      case "sales": return <SalesReport range={range} />;
      case "products": return <ProductSalesReport range={range} />;
      case "reps": return <RepSalesReport range={range} />;
      case "payments": return <PaymentsReport range={range} />;
      case "money": return <MoneyReport range={range} />;
      case "expenses": return <ExpensesReport range={range} />;
      case "profit": return <ProfitReport range={range} />;
      case "credit": return <CreditReport />;
      case "deposits": return <DepositsReport />;
      case "inventory": return <InventoryReport />;
      case "movements": return <MovementsReport range={range} />;
      case "returns": return <ReturnsReport range={range} />;
      case "exchanges": return <ExchangesReport range={range} />;
      case "payroll": return <PayrollReport />;
      case "loans": return <LoansReport />;
    }
  }, [report, range]);

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="text-xl font-extrabold text-[#22264B]">Reports</h1>
        <p className="text-sm text-[#22264B]/50">
          The business on paper — sales, money, stock and profit, ready to export.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => setReport(r.id)}
            className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors ${
              report === r.id
                ? "bg-[#22264B] text-white shadow-sm"
                : "bg-white text-[#22264B]/60 ring-1 ring-[#22264B]/10 hover:text-[#22264B]"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {RANGED_REPORTS.includes(report) && <RangeBar range={range} onChange={(r) => setRange(r)} />}

      {body}
    </div>
  );
}
