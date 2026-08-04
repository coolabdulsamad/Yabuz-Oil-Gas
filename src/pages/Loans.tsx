import { useMemo, useState } from "react";
import { HandCoins, Loader2, Plus, Search } from "lucide-react";
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
 * YABUZ OIL & GAS — staff loans (Admin & Super Admin).
 * Staff borrow from the company; repayment is deducted automatically from
 * their salary over the configured term (e.g. from this month across the
 * next 3 salaries). Disbursement books a "Staff Loans" expense; manual
 * repayments are supported too.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  ACTIVE: "border-blue-600/30 bg-blue-50 text-blue-700",
  PAID_OFF: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
  CANCELLED: "border-gray-500/30 bg-gray-100 text-gray-600",
};
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  ACTIVE: "Active",
  PAID_OFF: "Paid off",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/* ------------------------------ CREATE DIALOG ------------------------------ */

function NewLoanDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const now = new Date();
  const staffQuery = trpc.users.list.useQuery();
  const [userId, setUserId] = useState<number | null>(null);
  const [amount, setAmount] = useState(0);
  const [termMonths, setTermMonths] = useState(3);
  const [startYear, setStartYear] = useState(now.getFullYear());
  const [startMonth, setStartMonth] = useState(now.getMonth() + 1);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [approveNow, setApproveNow] = useState(true);

  const monthly = amount > 0 && termMonths > 0 ? amount / termMonths : 0;
  const staff = (staffQuery.data ?? []).filter((s) => s.status === "ACTIVE");

  const create = trpc.loans.create.useMutation({
    onSuccess: (r) => {
      toast.success(r.status === "ACTIVE" ? `Loan ${r.reference} disbursed — expense ${r.expenseRef} booked.` : `Loan ${r.reference} created (pending approval).`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!userId) return toast.error("Pick a staff member.");
    if (amount <= 0) return toast.error("Enter the loan amount.");
    if (reason.trim().length < 3) return toast.error("Give a reason for the loan.");
    create.mutate({ userId, amount, termMonths, startYear, startMonth, reason: reason.trim(), notes: notes.trim() || undefined, approveNow });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-3xl sm:max-w-3xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New staff loan</DialogTitle>
          <DialogDescription>Repayment is deducted automatically from the staff member's salary.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Staff member *</Label>
            <Select value={userId ? String(userId) : ""} onValueChange={(v) => setUserId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select staff…" /></SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.fullName} ({s.staffCode ?? s.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Amount (₦) *</Label>
              <Input type="number" min={0} step="any" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-1">
              <Label>Deduct over (months) *</Label>
              <Select value={String(termMonths)} onValueChange={(v) => setTermMonths(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[1,2,3,4,5,6,9,12,18,24,36].map((m) => <SelectItem key={m} value={String(m)}>{m} month{m > 1 ? "s" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>First deduction month</Label>
              <Select value={String(startMonth)} onValueChange={(v) => setStartMonth(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>First deduction year</Label>
              <Input type="number" value={startYear} onChange={(e) => setStartYear(Number(e.target.value) || now.getFullYear())} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Reason *</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Family emergency / rent support" />
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={approveNow} onCheckedChange={setApproveNow} id="approve-now" />
            <Label htmlFor="approve-now" className="cursor-pointer">
              Approve & disburse now
              <span className="block text-xs font-normal text-[#22264B]/50">Books a "Staff Loans" expense immediately</span>
            </Label>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-[#22264B] px-4 py-3 text-white">
            <span className="text-sm font-medium">Monthly deduction</span>
            <span className="text-lg font-black text-[#F7A026]">{formatMoney(monthly)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending}>
            {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            {approveNow ? "Disburse loan" : "Create loan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ DETAIL DIALOG ------------------------------ */

function LoanDetail({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("loans.manage");
  const q = trpc.loans.getById.useQuery({ id });
  const d = q.data;
  const [repayOpen, setRepayOpen] = useState(false);
  const [repayAmount, setRepayAmount] = useState(0);
  const now = new Date();

  const approve = trpc.loans.approve.useMutation({
    onSuccess: (r) => { toast.success(`Loan disbursed — expense ${r.expenseReference} booked.`); q.refetch(); onChanged(); },
    onError: (e) => toast.error(e.message),
  });
  const repay = trpc.loans.recordRepayment.useMutation({
    onSuccess: () => { toast.success("Repayment recorded."); setRepayOpen(false); q.refetch(); onChanged(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-4xl sm:max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Loan {d?.loan.reference}
            {d && <Badge variant="outline" className={STATUS_STYLES[d.loan.status]}>{STATUS_LABELS[d.loan.status]}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {d ? `${d.staff?.fullName} (${d.staff?.staffCode}) · created ${formatDateTime(d.loan.createdAt)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {!d ? (
          <Skeleton className="h-60 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-[#22264B]/5 p-3">
                <p className="text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Amount</p>
                <p className="font-black text-[#22264B]">{formatMoney(d.loan.amount)}</p>
              </div>
              <div className="rounded-lg bg-[#22264B]/5 p-3">
                <p className="text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Monthly deduction</p>
                <p className="font-black text-[#22264B]">{formatMoney(d.loan.monthlyDeduction)}</p>
              </div>
              <div className="rounded-lg bg-[#22264B]/5 p-3">
                <p className="text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Repaid</p>
                <p className="font-black text-emerald-600">{formatMoney(d.loan.amountRepaid)}</p>
              </div>
              <div className="rounded-lg bg-[#22264B]/5 p-3">
                <p className="text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Remaining</p>
                <p className="font-black text-amber-600">{formatMoney(d.loan.remainingBalance)}</p>
              </div>
            </div>

            <div className="space-y-1 rounded-lg bg-[#22264B]/5 p-3 text-sm">
              <p><span className="font-semibold">Reason:</span> {d.loan.reason}</p>
              <p>
                <span className="font-semibold">Terms:</span> {formatMoney(d.loan.monthlyDeduction)}/month × {d.loan.termMonths} from {MONTHS[d.loan.startMonth - 1]} {d.loan.startYear}
                {d.approverName ? ` · approved by ${d.approverName}` : ""}
              </p>
              {d.loan.rejectedReason && <p className="text-red-600"><span className="font-semibold">Rejected:</span> {d.loan.rejectedReason}</p>}
              {d.loan.notes && <p className="text-[#22264B]/60">{d.loan.notes}</p>}
            </div>

            {/* Schedule */}
            <div>
              <h4 className="mb-1 text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Deduction schedule</h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Instalment</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.schedule.map((s) => (
                    <TableRow key={`${s.year}-${s.month}`}>
                      <TableCell>{s.label}</TableCell>
                      <TableCell className="text-right font-medium">{formatMoney(s.amount)}</TableCell>
                      <TableCell>
                        {s.paid ? (
                          <Badge variant="outline" className={STATUS_STYLES.PAID_OFF}>Deducted</Badge>
                        ) : (
                          <Badge variant="outline" className="border-[#22264B]/20 text-[#22264B]/50">Upcoming</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Repayment history */}
            <div>
              <h4 className="mb-1 text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Repayment history</h4>
              {d.repayments.length === 0 ? (
                <p className="text-sm text-[#22264B]/50">No repayments yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {d.repayments.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{formatDateTime(r.createdAt)}</TableCell>
                        <TableCell>{MONTHS[r.periodMonth - 1]} {r.periodYear}</TableCell>
                        <TableCell className="text-[#22264B]/60">{r.note ?? "—"}</TableCell>
                        <TableCell className="text-right font-semibold">{formatMoney(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>

            {canManage && (
              <div className="flex justify-end gap-2">
                {d.loan.status === "PENDING" && (
                  <Button onClick={() => approve.mutate({ loanId: d.loan.id })} disabled={approve.isPending}>
                    {approve.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Approve & disburse
                  </Button>
                )}
                {d.loan.status === "ACTIVE" && (
                  <Button variant="outline" onClick={() => { setRepayAmount(Math.min(d.loan.monthlyDeduction, d.loan.remainingBalance)); setRepayOpen(true); }}>
                    Record manual repayment
                  </Button>
                )}
              </div>
            )}

            {repayOpen && (
              <div className="space-y-3 rounded-xl border border-[#F7A026]/40 bg-[#F7A026]/5 p-4">
                <p className="text-sm font-bold text-[#22264B]">Manual repayment (cash / transfer paid directly)</p>
                <div className="flex gap-2">
                  <Input type="number" min={0} max={d.loan.remainingBalance} step="any" value={repayAmount || ""} onChange={(e) => setRepayAmount(Number(e.target.value) || 0)} />
                  <Button
                    disabled={repay.isPending || repayAmount <= 0 || repayAmount > d.loan.remainingBalance}
                    onClick={() => repay.mutate({ loanId: d.loan.id, amount: repayAmount, periodYear: now.getFullYear(), periodMonth: now.getMonth() + 1, note: "Manual repayment" })}
                  >
                    {repay.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Save
                  </Button>
                  <Button variant="ghost" onClick={() => setRepayOpen(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- PAGE --------------------------------- */

export default function Loans() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("loans.manage");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listQuery = trpc.loans.list.useQuery({ status: status === "ALL" ? undefined : (status as never) });

  const rows = (listQuery.data ?? []).filter((r) =>
    search.trim()
      ? r.reference.toLowerCase().includes(search.toLowerCase()) || r.staffName.toLowerCase().includes(search.toLowerCase())
      : true,
  );
  const totals = useMemo(() => {
    const items = listQuery.data ?? [];
    return {
      active: items.filter((r) => r.status === "ACTIVE").length,
      outstanding: items.filter((r) => r.status === "ACTIVE").reduce((s, r) => s + r.remainingBalance, 0),
      disbursed: items.filter((r) => r.status !== "REJECTED" && r.status !== "CANCELLED").reduce((s, r) => s + r.amount, 0),
      recovered: items.reduce((s, r) => s + r.amountRepaid, 0),
    };
  }, [listQuery.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Staff Loans</h2>
          <p className="text-sm text-[#22264B]/55">
            Loans to staff, repaid by automatic salary deductions over the configured term.
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" /> New loan
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Active loans</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{totals.active}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Outstanding</p>
          <p className="mt-1 text-xl font-black text-amber-600">{formatMoney(totals.outstanding)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Total disbursed</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{formatMoney(totals.disbursed)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Recovered</p>
          <p className="mt-1 text-xl font-black text-emerald-600">{formatMoney(totals.recovered)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-[#22264B]/40" />
          <Input className="pl-9" placeholder="Search reference or staff…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PAID_OFF">Paid off</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        {listQuery.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <HandCoins className="size-8 text-[#22264B]/20" />
            <p className="text-sm text-[#22264B]/50">No staff loans yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Repaid</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                  <TableCell className="font-bold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell>
                    <p className="font-medium">{r.staffName}</p>
                    <p className="text-xs text-[#22264B]/50">{r.staffCode}</p>
                  </TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(r.amount)}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.monthlyDeduction)} × {r.termMonths}</TableCell>
                  <TableCell className="text-right text-emerald-600">{formatMoney(r.amountRepaid)}</TableCell>
                  <TableCell className="text-right text-amber-600">{formatMoney(r.remainingBalance)}</TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_STYLES[r.status]}>{STATUS_LABELS[r.status]}</Badge></TableCell>
                  <TableCell className="text-[#22264B]/60">{formatDateTime(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {createOpen && <NewLoanDialog onClose={() => setCreateOpen(false)} onDone={() => listQuery.refetch()} />}
      {detailId != null && <LoanDetail id={detailId} onClose={() => setDetailId(null)} onChanged={() => listQuery.refetch()} />}
    </div>
  );
}
