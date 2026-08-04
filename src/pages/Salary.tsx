import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Banknote, CalendarPlus, Loader2, Printer, Settings2, Wallet, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

/**
 * YABUZ OIL & GAS — payroll & salary configuration (Admin & Super Admin).
 * Salary Config tab: full per-staff package (basic, allowances, bonus,
 * tax/pension/VAT/other deductions).
 * Payroll tab: generate a month's payslips (loans auto-deducted), record
 * payment (auto-books a "Salaries & Wages" expense), print payslips.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  PAID: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-gray-500/30 bg-gray-100 text-gray-600",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function monthLabel(year: number, month: number) {
  return `${MONTHS[month - 1]} ${year}`;
}

/* --------------------------- CONFIG EDIT DIALOG --------------------------- */

function ConfigDialog({
  staff,
  onClose,
  onDone,
}: {
  staff: {
    id: number;
    fullName: string;
    staffCode: string | null;
    config: Record<string, unknown> | null;
  };
  onClose: () => void;
  onDone: () => void;
}) {
  const c = staff.config as null | {
    basicSalary: number; housingAllowance: number; transportAllowance: number; mealAllowance: number;
    otherAllowance: number; monthlyBonus: number; taxPercent: number; pensionPercent: number;
    vatPercent: number; otherDeduction: number; deductionNote: string | null; isActive: boolean;
    effectiveFrom: string | Date | null; notes: string | null;
  };
  const [form, setForm] = useState({
    basicSalary: c?.basicSalary ?? 0,
    housingAllowance: c?.housingAllowance ?? 0,
    transportAllowance: c?.transportAllowance ?? 0,
    mealAllowance: c?.mealAllowance ?? 0,
    otherAllowance: c?.otherAllowance ?? 0,
    monthlyBonus: c?.monthlyBonus ?? 0,
    taxPercent: c?.taxPercent ?? 0,
    pensionPercent: c?.pensionPercent ?? 0,
    vatPercent: c?.vatPercent ?? 0,
    otherDeduction: c?.otherDeduction ?? 0,
    deductionNote: c?.deductionNote ?? "",
    isActive: c?.isActive ?? true,
    effectiveFrom: c?.effectiveFrom ? String(c.effectiveFrom).slice(0, 10) : "",
    notes: c?.notes ?? "",
  });
  const set = (k: string, v: number | string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const gross = form.basicSalary + form.housingAllowance + form.transportAllowance + form.mealAllowance + form.otherAllowance + form.monthlyBonus;
  const tax = (gross * form.taxPercent) / 100;
  const pension = (form.basicSalary * form.pensionPercent) / 100;
  const vat = (gross * form.vatPercent) / 100;
  const net = gross - tax - pension - vat - form.otherDeduction;

  const save = trpc.salary.saveConfig.useMutation({
    onSuccess: () => { toast.success(`Salary configuration saved for ${staff.fullName}.`); onDone(); onClose(); },
    onError: (e) => toast.error(e.message),
  });

  const moneyField = (key: string, label: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} step="any" value={(form as never)[key]} onChange={(e) => set(key, Number(e.target.value) || 0)} />
    </div>
  );
  const pctField = (key: string, label: string) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} max={100} step="any" value={(form as never)[key]} onChange={(e) => set(key, Number(e.target.value) || 0)} />
    </div>
  );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="p-3 sm:p-6 max-h-[92vh] w-[95vw] max-w-5xl sm:max-w-5xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Salary configuration — {staff.fullName}</DialogTitle>
          <DialogDescription>{staff.staffCode ?? ""} · everything below is snapshotted onto each payslip.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Earnings (monthly)</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {moneyField("basicSalary", "Basic salary (₦)")}
              {moneyField("housingAllowance", "Housing allowance (₦)")}
              {moneyField("transportAllowance", "Transport allowance (₦)")}
              {moneyField("mealAllowance", "Meal allowance (₦)")}
              {moneyField("otherAllowance", "Other allowances (₦)")}
              {moneyField("monthlyBonus", "Standing bonus (₦)")}
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Deductions</h4>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {pctField("taxPercent", "PAYE tax (% of gross)")}
              {pctField("pensionPercent", "Pension (% of basic)")}
              {pctField("vatPercent", "VAT (% of gross)")}
              {moneyField("otherDeduction", "Other fixed deduction (₦)")}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Deduction note</Label>
                <Input value={form.deductionNote} onChange={(e) => set("deductionNote", e.target.value)} placeholder="e.g. union dues + welfare" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Effective from</Label>
                <Input type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} id="cfg-active" />
            <Label htmlFor="cfg-active" className="cursor-pointer">Active — included when payroll is generated</Label>
          </div>
          <div className="grid grid-cols-3 gap-3 rounded-xl bg-[#22264B] p-4 text-white">
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase opacity-60">Gross / month</p>
              <p className="text-lg font-black">{formatMoney(gross)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase opacity-60">Deductions</p>
              <p className="text-lg font-black">{formatMoney(tax + pension + vat + form.otherDeduction)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold tracking-widest uppercase opacity-60">Est. net (excl. loans)</p>
              <p className="text-lg font-black text-[#F7A026]">{formatMoney(net)}</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate({ userId: staff.id, ...form, effectiveFrom: form.effectiveFrom || undefined, deductionNote: form.deductionNote || undefined, notes: form.notes || undefined })} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- GENERATE DIALOG --------------------------- */

function GenerateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const gen = trpc.salary.generate.useMutation({
    onSuccess: (r) => {
      if (r.created.length === 0) toast.info(`Payroll for ${monthLabel(year, month)} already exists for everyone.`);
      else toast.success(`Generated ${r.created.length} payslip(s) for ${monthLabel(year, month)}.`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[95vw] max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate payroll</DialogTitle>
          <DialogDescription>Creates a PENDING payslip for every staff with an active salary config. Active loans are deducted automatically.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Month</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Year</Label>
            <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => gen.mutate({ year, month, bonuses: [] })} disabled={gen.isPending}>
            {gen.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ PAY DIALOG ------------------------------ */

function PayDialog({
  pay,
  onClose,
  onDone,
}: {
  pay: { id: number; reference: string; staffName: string; netPay: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<"BANK_TRANSFER" | "CASH" | "CHEQUE">("BANK_TRANSFER");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const payMut = trpc.salary.pay.useMutation({
    onSuccess: (r) => { toast.success(`Salary paid — expense ${r.expenseReference} booked automatically.`); onDone(); onClose(); },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-[95vw] max-w-lg sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay salary — {pay.staffName}</DialogTitle>
          <DialogDescription>{pay.reference} · net pay <strong>{formatMoney(pay.netPay)}</strong>. An approved expense is booked automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Payment method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CHEQUE">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Transfer reference / cheque no</Label>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. GTB-TRF-88340291" />
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => payMut.mutate({ paymentId: pay.id, paymentMethod: method, paymentReference: ref.trim() || undefined, notes: notes.trim() || undefined })} disabled={payMut.isPending}>
            {payMut.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Confirm payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- PAGE --------------------------------- */

export default function Salary() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("salary.manage");
  const now = new Date();
  const [year, setYear] = useState<number | "ALL">(now.getFullYear());
  const [month, setMonth] = useState<number | "ALL">("ALL");
  const [status, setStatus] = useState("ALL");
  const [genOpen, setGenOpen] = useState(false);
  const [payTarget, setPayTarget] = useState<{ id: number; reference: string; staffName: string; netPay: number } | null>(null);
  const [configTarget, setConfigTarget] = useState<never | null>(null);
  const [cancelTarget, setCancelTarget] = useState<number | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const configsQuery = trpc.salary.listConfigs.useQuery();
  const paymentsQuery = trpc.salary.listPayments.useQuery({
    status: status === "ALL" ? undefined : (status as never),
    year: year === "ALL" ? undefined : year,
    month: month === "ALL" ? undefined : month,
  });
  const cancelMut = trpc.salary.cancel.useMutation({
    onSuccess: () => { toast.success("Payslip cancelled."); paymentsQuery.refetch(); setCancelTarget(null); setCancelReason(""); },
    onError: (e) => toast.error(e.message),
  });

  const rows = paymentsQuery.data ?? [];
  const totals = useMemo(() => {
    const paid = rows.filter((r) => r.status === "PAID");
    return {
      count: rows.length,
      pending: rows.filter((r) => r.status === "PENDING").length,
      gross: paid.reduce((s, r) => s + r.grossPay, 0),
      net: paid.reduce((s, r) => s + r.netPay, 0),
    };
  }, [rows]);
  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear()]);
    (paymentsQuery.data ?? []).forEach((r) => set.add(r.periodYear));
    return [...set].sort((a, b) => b - a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentsQuery.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Salary Management</h2>
          <p className="text-sm text-[#22264B]/55">
            Staff salary packages, monthly payroll, payments and payslips — every payment is booked as a company expense.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setGenOpen(true)}>
            <CalendarPlus className="mr-2 size-4" /> Generate payroll
          </Button>
        )}
      </div>

      <Tabs defaultValue="payroll">
        <TabsList>
          <TabsTrigger value="payroll"><Wallet className="mr-2 size-4" />Payroll</TabsTrigger>
          <TabsTrigger value="config"><Settings2 className="mr-2 size-4" />Salary configuration</TabsTrigger>
        </TabsList>

        {/* ------------------------------ PAYROLL ------------------------------ */}
        <TabsContent value="payroll" className="space-y-4 pt-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Payslips</p>
              <p className="mt-1 text-xl font-black text-[#22264B]">{totals.count}</p>
            </div>
            <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Awaiting payment</p>
              <p className="mt-1 text-xl font-black text-amber-600">{totals.pending}</p>
            </div>
            <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Gross paid</p>
              <p className="mt-1 text-xl font-black text-[#22264B]">{formatMoney(totals.gross)}</p>
            </div>
            <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
              <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Net paid</p>
              <p className="mt-1 text-xl font-black text-emerald-600">{formatMoney(totals.net)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Select value={String(year)} onValueChange={(v) => setYear(v === "ALL" ? "ALL" : Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All years</SelectItem>
                {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={(v) => setMonth(v === "ALL" ? "ALL" : Number(v))}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All months</SelectItem>
                {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="PAID">Paid</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
            {paymentsQuery.isLoading ? (
              <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-10 text-center">
                <Banknote className="size-8 text-[#22264B]/20" />
                <p className="text-sm text-[#22264B]/50">No payslips for this filter — generate payroll to create them.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net pay</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-bold text-[#22264B]">{r.reference}</TableCell>
                      <TableCell>
                        <p className="font-medium">{r.staffName}</p>
                        <p className="text-xs text-[#22264B]/50">{r.staffCode}</p>
                      </TableCell>
                      <TableCell>{monthLabel(r.periodYear, r.periodMonth)}</TableCell>
                      <TableCell className="text-right">{formatMoney(r.grossPay)}</TableCell>
                      <TableCell className="text-right text-red-600">−{formatMoney(r.totalDeductions)}</TableCell>
                      <TableCell className="text-right font-bold">{formatMoney(r.netPay)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLES[r.status]}>{r.status}</Badge>
                        {r.status === "PAID" && r.paidAt && <p className="mt-0.5 text-[10px] text-[#22264B]/45">{formatDateTime(r.paidAt)}</p>}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link to={`/salary/${r.id}/payslip`} target="_blank">
                            <Button size="icon" variant="ghost" title="Print payslip"><Printer className="size-4" /></Button>
                          </Link>
                          {canManage && r.status === "PENDING" && (
                            <>
                              <Button size="sm" onClick={() => setPayTarget({ id: r.id, reference: r.reference, staffName: r.staffName, netPay: r.netPay })}>Pay</Button>
                              <Button size="icon" variant="ghost" title="Cancel payslip" onClick={() => setCancelTarget(r.id)}><XCircle className="size-4 text-red-500" /></Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>

        {/* ------------------------------- CONFIG ------------------------------- */}
        <TabsContent value="config" className="space-y-4 pt-4">
          <div className="rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
            {configsQuery.isLoading ? (
              <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Staff</TableHead>
                    <TableHead>Bank details</TableHead>
                    <TableHead className="text-right">Basic</TableHead>
                    <TableHead className="text-right">Est. gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(configsQuery.data ?? []).map((s) => {
                    const c = s.config;
                    const gross = c ? c.basicSalary + c.housingAllowance + c.transportAllowance + c.mealAllowance + c.otherAllowance + c.monthlyBonus : 0;
                    const ded = c ? (gross * c.taxPercent) / 100 + (c.basicSalary * c.pensionPercent) / 100 + (gross * c.vatPercent) / 100 + c.otherDeduction : 0;
                    return (
                      <TableRow key={s.id}>
                        <TableCell>
                          <p className="font-medium text-[#22264B]">{s.fullName}</p>
                          <p className="text-xs text-[#22264B]/50">{s.staffCode} · {s.jobTitle ?? s.role}</p>
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.bankName ? (
                            <>
                              <p>{s.bankName} · {s.bankAccountNumber}</p>
                              <p className="text-xs text-[#22264B]/50">{s.bankAccountName}</p>
                            </>
                          ) : (
                            <span className="text-xs text-amber-600">No bank details — add in Staff page</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">{c ? formatMoney(c.basicSalary) : "—"}</TableCell>
                        <TableCell className="text-right">{c ? formatMoney(gross) : "—"}</TableCell>
                        <TableCell className="text-right text-red-600">{c ? `−${formatMoney(ded)}` : "—"}</TableCell>
                        <TableCell>
                          {c ? (
                            <Badge variant="outline" className={c.isActive ? STATUS_STYLES.PAID : STATUS_STYLES.CANCELLED}>{c.isActive ? "Active" : "Inactive"}</Badge>
                          ) : (
                            <Badge variant="outline" className="border-[#22264B]/20 text-[#22264B]/50">Not configured</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && (
                            <Button size="sm" variant="outline" onClick={() => setConfigTarget(s as never)}>
                              {c ? "Edit" : "Configure"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {genOpen && <GenerateDialog onClose={() => setGenOpen(false)} onDone={() => paymentsQuery.refetch()} />}
      {payTarget && <PayDialog pay={payTarget} onClose={() => setPayTarget(null)} onDone={() => paymentsQuery.refetch()} />}
      {configTarget && <ConfigDialog staff={configTarget} onClose={() => setConfigTarget(null)} onDone={() => configsQuery.refetch()} />}

      <Dialog open={cancelTarget != null} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <DialogContent className="w-[95vw] max-w-md sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel payslip</DialogTitle>
            <DialogDescription>Only pending payslips can be cancelled. This is recorded in the audit log.</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason…" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>Back</Button>
            <Button variant="destructive" disabled={cancelMut.isPending || cancelReason.trim().length < 3} onClick={() => cancelTarget && cancelMut.mutate({ paymentId: cancelTarget, reason: cancelReason.trim() })}>
              Cancel payslip
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
