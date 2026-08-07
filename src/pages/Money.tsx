import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowDownUp,
  Banknote,
  Landmark,
  Plus,
  Printer,
  Search,
  Trash2,
  Loader2,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";

/**
 * YABUZ OIL & GAS — cash & bank (money movements).
 * Every real-money event in one place: sales payments, credit repayments,
 * deposits, other income → IN; expenses, salaries, loans, deposit refunds,
 * other payouts → OUT. Credit sales and deposit-wallet usage are excluded
 * (no actual money moves). Filterable, with per-method balances, printable.
 */

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  POS: "POS",
  CHEQUE: "Cheque",
};

const SOURCE_LABELS: Record<string, string> = {
  SALE_PAYMENT: "Sale payment",
  CREDIT_PAYMENT: "Credit repayment",
  ADVANCE_DEPOSIT: "Advance deposit",
  OTHER_IN: "Other income",
  EXPENSE: "Expense",
  SALARY: "Salary",
  LOAN: "Staff loan",
  DEPOSIT_REFUND: "Deposit refund",
  OTHER_OUT: "Other payout",
};

const SOURCE_STYLES: Record<string, string> = {
  SALE_PAYMENT: "bg-emerald-50 text-emerald-700 border-emerald-200",
  CREDIT_PAYMENT: "bg-teal-50 text-teal-700 border-teal-200",
  ADVANCE_DEPOSIT: "bg-sky-50 text-sky-700 border-sky-200",
  OTHER_IN: "bg-lime-50 text-lime-700 border-lime-200",
  EXPENSE: "bg-red-50 text-red-700 border-red-200",
  SALARY: "bg-violet-50 text-violet-700 border-violet-200",
  LOAN: "bg-amber-50 text-amber-700 border-amber-200",
  DEPOSIT_REFUND: "bg-orange-50 text-orange-700 border-orange-200",
  OTHER_OUT: "bg-rose-50 text-rose-700 border-rose-200",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function monthStartStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function Money() {
  const { hasPermission, user } = useAuth();
  const canManage = hasPermission("money.manage");

  const [dateFrom, setDateFrom] = useState(monthStartStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [direction, setDirection] = useState<string>("ALL");
  const [method, setMethod] = useState<string>("ALL");
  const [source, setSource] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const filters = useMemo(
    () => ({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      direction: direction === "ALL" ? undefined : (direction as "IN" | "OUT"),
      method: method === "ALL" ? undefined : (method as "CASH" | "BANK_TRANSFER" | "POS" | "CHEQUE"),
      source: source === "ALL" ? undefined : (source as never),
      search: search.trim() || undefined,
    }),
    [dateFrom, dateTo, direction, method, source, search],
  );

  const overview = trpc.money.overview.useQuery(filters);
  const rows = overview.data?.rows ?? [];
  const summary = overview.data?.summary;

  const utils = trpc.useUtils();
  const createMovement = trpc.money.createMovement.useMutation({
    onSuccess: (r) => {
      toast.success(`Recorded ${r.reference}`);
      setCreateOpen(false);
      utils.money.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMovement = trpc.money.deleteMovement.useMutation({
    onSuccess: () => {
      toast.success("Entry removed");
      utils.money.overview.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  /* ---- create form state ---- */
  const [mDirection, setMDirection] = useState<"IN" | "OUT">("IN");
  const [mMethod, setMMethod] = useState<string>("CASH");
  const [mLabel, setMLabel] = useState("");
  const [mAmount, setMAmount] = useState("");
  const [mDate, setMDate] = useState(todayStr());
  const [mDesc, setMDesc] = useState("");

  const submitMovement = () => {
    const amount = Number(mAmount);
    if (!mLabel.trim()) return toast.error("Give the entry a short label.");
    if (!amount || amount <= 0) return toast.error("Enter a valid amount.");
    createMovement.mutate({
      direction: mDirection,
      method: mMethod as never,
      label: mLabel.trim(),
      amount,
      description: mDesc.trim() || undefined,
      movementDate: mDate,
    });
  };

  const filterSummary = [
    dateFrom || dateTo ? `${dateFrom || "…"} → ${dateTo || "…"}` : "All dates",
    direction !== "ALL" ? (direction === "IN" ? "Money in" : "Money out") : "In & out",
    method !== "ALL" ? METHOD_LABELS[method] : "All methods",
    source !== "ALL" ? SOURCE_LABELS[source] : "All sources",
  ].join(" · ");

  return (
    <div className="space-y-5">
      {/* ------- header ------- */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Cash & Bank</h2>
          <p className="text-sm text-[#22264B]/55">
            Every real-money movement — sales, credit repayments, deposits in; expenses, salaries, loans, refunds out.
            Credit sales and deposit-wallet usage move no money, so they're excluded.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} disabled={!rows.length}>
            <Printer className="mr-2 size-4" /> Print
          </Button>
          {canManage && (
            <Button className="bg-[#22264B] hover:bg-[#22264B]/90" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" /> Record other movement
            </Button>
          )}
        </div>
      </div>

      {/* ------- filters ------- */}
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-[#22264B]/10 bg-white p-3 shadow-sm sm:grid-cols-3 lg:grid-cols-6 print:hidden">
        <div>
          <Label className="text-[11px]">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-[11px]">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9" />
        </div>
        <div>
          <Label className="text-[11px]">Direction</Label>
          <Select value={direction} onValueChange={setDirection}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">In & out</SelectItem>
              <SelectItem value="IN">Money in</SelectItem>
              <SelectItem value="OUT">Money out</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">Method</Label>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All methods</SelectItem>
              {Object.entries(METHOD_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">Source</Label>
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All sources</SelectItem>
              {Object.entries(SOURCE_LABELS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[11px]">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#22264B]/40" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Ref, party…" className="h-9 pl-8" />
          </div>
        </div>
      </div>

      {/* ------- summary cards ------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 print:hidden">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-emerald-700/70 uppercase">
            <ArrowDownLeft className="size-3.5" /> Money in
          </div>
          {overview.isLoading ? <Skeleton className="mt-2 h-7 w-28" /> : (
            <p className="mt-1 text-xl font-black text-emerald-700">{formatMoney(summary?.totalIn ?? 0)}</p>
          )}
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-red-700/70 uppercase">
            <ArrowUpRight className="size-3.5" /> Money out
          </div>
          {overview.isLoading ? <Skeleton className="mt-2 h-7 w-28" /> : (
            <p className="mt-1 text-xl font-black text-red-600">{formatMoney(summary?.totalOut ?? 0)}</p>
          )}
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">
            <ArrowDownUp className="size-3.5" /> Net flow
          </div>
          {overview.isLoading ? <Skeleton className="mt-2 h-7 w-28" /> : (
            <p className={`mt-1 text-xl font-black ${(summary?.net ?? 0) >= 0 ? "text-[#22264B]" : "text-red-600"}`}>
              {formatMoney(summary?.net ?? 0)}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Transactions</p>
          {overview.isLoading ? <Skeleton className="mt-2 h-7 w-16" /> : (
            <p className="mt-1 text-xl font-black text-[#22264B]">{summary?.count ?? 0}</p>
          )}
        </div>
      </div>

      {/* ------- per-method balances ------- */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        {(summary?.methods ?? []).map((m) => (
          <div key={m.method} className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold text-[#22264B]">
                {m.method === "CASH" ? <Banknote className="size-4 text-[#F7A026]" /> : <Landmark className="size-4 text-[#22264B]/60" />}
                {METHOD_LABELS[m.method]}
              </p>
              <p className={`text-sm font-black ${m.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {formatMoney(m.balance)}
              </p>
            </div>
            <div className="mt-2 flex justify-between text-xs text-[#22264B]/55">
              <span>In <span className="font-bold text-emerald-600">{formatMoney(m.in)}</span></span>
              <span>Out <span className="font-bold text-red-600">{formatMoney(m.out)}</span></span>
            </div>
          </div>
        ))}
      </div>

      {/* ------- source breakdown ------- */}
      {summary && summary.sources.length > 0 && (
        <div className="flex flex-wrap gap-2 print:hidden">
          {summary.sources.map((s) => (
            <button
              key={s.source}
              onClick={() => setSource(source === s.source ? "ALL" : s.source)}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${SOURCE_STYLES[s.source]} ${source === s.source ? "ring-2 ring-[#22264B]/30" : "opacity-80 hover:opacity-100"}`}
            >
              {SOURCE_LABELS[s.source]} · {formatMoney(s.total)} ({s.count})
            </button>
          ))}
        </div>
      )}

      {/* ------- transactions table ------- */}
      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm print:hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Transaction</TableHead>
              <TableHead className="hidden sm:table-cell">Source</TableHead>
              <TableHead className="hidden md:table-cell">Method</TableHead>
              <TableHead className="hidden lg:table-cell">Party / details</TableHead>
              <TableHead className="hidden sm:table-cell">Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={canManage ? 7 : 6}><Skeleton className="h-5 w-full" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 7 : 6} className="py-10 text-center text-sm text-[#22264B]/45">
                  No money movements match these filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[150px] sm:max-w-none">
                    <p className="truncate font-mono text-xs font-bold text-[#22264B]">{r.reference}</p>
                    <p className="truncate text-xs text-[#22264B]/50 sm:hidden">
                      {SOURCE_LABELS[r.source]} · {METHOD_LABELS[r.method]}
                    </p>
                    <p className="hidden truncate text-xs text-[#22264B]/50 sm:block">{r.recordedBy ?? ""}</p>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-bold ${SOURCE_STYLES[r.source]}`}>
                      {SOURCE_LABELS[r.source]}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-[#22264B]/70">{METHOD_LABELS[r.method]}</TableCell>
                  <TableCell className="hidden max-w-[260px] lg:table-cell">
                    <p className="truncate text-sm text-[#22264B]/80">{r.party ?? "—"}</p>
                    {r.description && <p className="truncate text-xs text-[#22264B]/45">{r.description}</p>}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-xs text-[#22264B]/60 sm:table-cell">
                    {formatDateTime(r.date)}
                  </TableCell>
                  <TableCell className={`text-right font-black ${r.direction === "IN" ? "text-emerald-600" : "text-red-600"}`}>
                    {r.direction === "IN" ? "+" : "−"}{formatMoney(r.amount)}
                  </TableCell>
                  {canManage && (
                    <TableCell>
                      {r.id.startsWith("mm-") && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-red-500 hover:bg-red-50"
                          disabled={deleteMovement.isPending}
                          onClick={() => {
                            if (confirm(`Delete ${r.reference}? This cannot be undone.`)) {
                              deleteMovement.mutate({ id: Number(r.id.slice(3)) });
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* ------- printable view ------- */}
      <div className="hidden print:block">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-black">Yabuz Oil and Gas Ltd</h1>
            <p className="text-sm font-bold">Money movements — cash &amp; bank</p>
            <p className="text-xs text-gray-500">{filterSummary}</p>
          </div>
          <p className="text-xs text-gray-500">Printed {formatDateTime(new Date().toISOString())} by {user?.fullName ?? ""}</p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              {["Date", "Reference", "Source", "Method", "Party / details", "In (₦)", "Out (₦)"].map((h) => (
                <th key={h} style={{ borderBottom: "2px solid #22264B", textAlign: "left", padding: "4px 6px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px" }}>{formatDate(r.date)}</td>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", fontFamily: "monospace" }}>{r.reference}</td>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px" }}>{SOURCE_LABELS[r.source]}</td>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px" }}>{METHOD_LABELS[r.method]}</td>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px" }}>
                  {r.party ?? ""}{r.description ? ` — ${r.description}` : ""}
                </td>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>
                  {r.direction === "IN" ? r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ""}
                </td>
                <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>
                  {r.direction === "OUT" ? r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ""}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ borderTop: "2px solid #22264B", padding: "4px 6px", fontWeight: 800 }}>TOTALS</td>
              <td style={{ borderTop: "2px solid #22264B", padding: "4px 6px", textAlign: "right", fontWeight: 800 }}>
                {(summary?.totalIn ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td style={{ borderTop: "2px solid #22264B", padding: "4px 6px", textAlign: "right", fontWeight: 800 }}>
                {(summary?.totalOut ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
            <tr>
              <td colSpan={5} style={{ padding: "4px 6px", fontWeight: 800 }}>NET FLOW</td>
              <td colSpan={2} style={{ padding: "4px 6px", textAlign: "right", fontWeight: 800 }}>
                {(summary?.net ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
            {(summary?.methods ?? []).map((m) => (
              <tr key={m.method}>
                <td colSpan={5} style={{ padding: "2px 6px", color: "#555" }}>{METHOD_LABELS[m.method]} balance</td>
                <td colSpan={2} style={{ padding: "2px 6px", textAlign: "right", color: "#555" }}>
                  {m.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </td>
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      <style>{`@media print { body { background: white; } @page { margin: 12mm; } }`}</style>

      {/* ------- record other movement dialog ------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="w-[95vw] max-w-lg sm:max-w-lg p-3 sm:p-6">
          <DialogHeader>
            <DialogTitle>Record other money movement</DialogTitle>
            <DialogDescription>
              For real money that isn't a sale, deposit, expense, salary or loan — e.g. owner capital, bank charges.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Direction</Label>
              <Select value={mDirection} onValueChange={(v) => setMDirection(v as "IN" | "OUT")}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Money in</SelectItem>
                  <SelectItem value="OUT">Money out</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Method</Label>
              <Select value={mMethod} onValueChange={setMMethod}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METHOD_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Label</Label>
              <Input value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="e.g. Owner capital" className="h-10" />
            </div>
            <div>
              <Label>Amount (₦)</Label>
              <Input type="number" min="0" step="0.01" value={mAmount} onChange={(e) => setMAmount(e.target.value)} className="h-10" />
            </div>
            <div className="col-span-2">
              <Label>Date</Label>
              <Input type="date" value={mDate} onChange={(e) => setMDate(e.target.value)} className="h-10" />
            </div>
            <div className="col-span-2">
              <Label>Description (optional)</Label>
              <Textarea value={mDesc} onChange={(e) => setMDesc(e.target.value)} rows={2} placeholder="Extra details…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button className="bg-[#22264B] hover:bg-[#22264B]/90" onClick={submitMovement} disabled={createMovement.isPending}>
              {createMovement.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
