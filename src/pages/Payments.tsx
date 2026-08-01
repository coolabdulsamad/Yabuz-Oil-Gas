import { useState } from "react";
import { Link } from "react-router";
import { Loader2, Plus, Search, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cloudinaryThumb } from "@/lib/cloudinary";
import { RecordPaymentDialog } from "@/components/payments/RecordPaymentDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
 * YABUZ OIL & GAS — payments register.
 * Money in/out with proofs, flowing through the approval chain.
 * Overpayments land in the customer's deposit wallet at confirmation.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING_APPROVAL: "border-amber-600/30 bg-amber-50 text-amber-700",
  CONFIRMED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
};

export const PAYMENT_TYPE_LABELS: Record<string, string> = {
  SALE_PAYMENT: "Sale payment",
  CREDIT_PAYMENT: "Credit repayment",
  ADVANCE_DEPOSIT: "Advance deposit",
  DEPOSIT_REFUND: "Deposit refund",
};

const METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  POS: "POS",
  CHEQUE: "Cheque",
  DEPOSIT_BALANCE: "Deposit wallet",
};

function PaymentDetailDialog({ paymentId, onClose }: { paymentId: number | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [reason, setReason] = useState("");
  const query = trpc.payments.getById.useQuery({ id: paymentId! }, { enabled: paymentId !== null });
  const withdrawMutation = trpc.payments.withdraw.useMutation({
    onSuccess: async () => {
      toast.success("Payment withdrawn.");
      setWithdrawOpen(false);
      await utils.payments.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const data = query.data;
  const p = data?.payment;
  return (
    <Dialog open={paymentId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {p?.reference ?? "Payment"}
            {p && (
              <Badge variant="outline" className={STATUS_STYLES[p.status]}>
                {p.status === "PENDING_APPROVAL" ? "Pending" : p.status}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>{p ? PAYMENT_TYPE_LABELS[p.paymentType] : ""}</DialogDescription>
        </DialogHeader>
        {query.isLoading && <Skeleton className="h-48 w-full" />}
        {data && p && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg bg-[#22264B]/[0.03] px-3 py-2">
                <span className="block text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Amount</span>
                <span className="text-base font-black text-[#22264B]">{formatMoney(p.amount)}</span>
              </div>
              <div className="rounded-lg bg-[#22264B]/[0.03] px-3 py-2">
                <span className="block text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Method</span>
                <span className="font-semibold text-[#22264B]">{METHOD_LABELS[p.method] ?? p.method}</span>
              </div>
              <div className="rounded-lg bg-[#22264B]/[0.03] px-3 py-2">
                <span className="block text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Customer</span>
                {data.customer ? (
                  <Link to={`/customers/${data.customer.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {data.customer.fullName}
                  </Link>
                ) : (
                  <span className="text-[#22264B]/50">Walk-in</span>
                )}
              </div>
              <div className="rounded-lg bg-[#22264B]/[0.03] px-3 py-2">
                <span className="block text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Sale</span>
                {data.sale ? (
                  <Link to={`/sales/${data.sale.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {data.sale.orderNo}
                  </Link>
                ) : (
                  <span className="text-[#22264B]/50">—</span>
                )}
              </div>
              {p.status === "CONFIRMED" && (
                <>
                  <div className="rounded-lg bg-emerald-50 px-3 py-2">
                    <span className="block text-[10px] font-bold tracking-widest text-emerald-700/60 uppercase">Applied to sale</span>
                    <span className="font-bold text-emerald-700">{formatMoney(p.appliedToSale)}</span>
                  </div>
                  <div className="rounded-lg bg-emerald-50 px-3 py-2">
                    <span className="block text-[10px] font-bold tracking-widest text-emerald-700/60 uppercase">Added to deposit</span>
                    <span className="font-bold text-emerald-700">{formatMoney(p.addedToDeposit)}</span>
                  </div>
                </>
              )}
            </div>

            {p.externalReference && (
              <p className="text-sm text-[#22264B]/70">
                <strong>External ref:</strong> {p.externalReference}
              </p>
            )}
            {p.notes && <p className="text-sm whitespace-pre-wrap text-[#22264B]/70">{p.notes}</p>}

            {p.proofUrl ? (
              <div>
                <span className="mb-1.5 block text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Proof</span>
                <a href={p.proofUrl} target="_blank" rel="noreferrer">
                  <img
                    src={cloudinaryThumb(p.proofUrl, 500)}
                    alt="Payment proof"
                    className="max-h-56 rounded-lg border border-[#22264B]/10 object-contain"
                  />
                </a>
              </div>
            ) : (
              <p className="text-xs text-[#22264B]/45">No proof attached (cash payment).</p>
            )}

            <p className="text-xs text-[#22264B]/50">
              Recorded by {data.recorderName} · {formatDateTime(p.createdAt)}
              {p.status === "CONFIRMED" && data.confirmerName && (
                <>
                  <br />Confirmed by {data.confirmerName} · {formatDateTime(p.confirmedAt)}
                </>
              )}
              {p.status === "REJECTED" && p.rejectedReason && (
                <>
                  <br />Rejected: {p.rejectedReason}
                </>
              )}
            </p>

            {data.canWithdraw && !withdrawOpen && (
              <Button variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => setWithdrawOpen(true)}>
                <Undo2 className="mr-1 size-4" /> Withdraw payment
              </Button>
            )}
            {data.canWithdraw && withdrawOpen && (
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
                <Label htmlFor="withdraw-reason" className="text-red-700">Reason for withdrawing</Label>
                <Textarea id="withdraw-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setWithdrawOpen(false)}>Keep it</Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={reason.trim().length < 3 || withdrawMutation.isPending}
                    onClick={() => withdrawMutation.mutate({ paymentId: p.id, reason: reason.trim() })}
                  >
                    {withdrawMutation.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                    Withdraw
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Payments() {
  const { hasPermission } = useAuth();
  const canRecord = hasPermission("payments.record");
  const canViewAll = hasPermission("payments.view_all");

  const [tab, setTab] = useState<"ALL" | "PENDING_APPROVAL" | "CONFIRMED" | "REJECTED">("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [recordOpen, setRecordOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listQuery = trpc.payments.list.useQuery({
    status: tab === "ALL" ? undefined : tab,
    paymentType: typeFilter === "ALL" ? undefined : (typeFilter as "SALE_PAYMENT" | "CREDIT_PAYMENT" | "ADVANCE_DEPOSIT" | "DEPOSIT_REFUND"),
    search: search.trim() || undefined,
  });
  const rows = listQuery.data?.items ?? [];
  const stats = listQuery.data?.stats;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Payments</h2>
          <p className="text-sm text-[#22264B]/55">
            {canViewAll ? "Every payment with its proof, through the approval chain." : "Payments you've recorded."}
          </p>
        </div>
        {canRecord && (
          <Button className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]" onClick={() => setRecordOpen(true)}>
            <Plus className="mr-1 size-4" /> Record payment
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Confirmed today</p>
          <p className="mt-1 text-xl font-black text-emerald-700">{formatMoney(stats?.confirmedToday ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Awaiting approval</p>
          <p className={`mt-1 text-xl font-black ${(stats?.pendingCount ?? 0) > 0 ? "text-amber-600" : "text-[#22264B]"}`}>
            {stats?.pendingCount ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm max-md:col-span-2">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">In this view</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{rows.length} payment{rows.length === 1 ? "" : "s"}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="ALL">All</TabsTrigger>
            <TabsTrigger value="PENDING_APPROVAL">Pending</TabsTrigger>
            <TabsTrigger value="CONFIRMED">Confirmed</TabsTrigger>
            <TabsTrigger value="REJECTED">Rejected</TabsTrigger>
          </TabsList>
        </Tabs>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {Object.entries(PAYMENT_TYPE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search reference…" className="pl-9" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Reference</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customer / Sale</TableHead>
              <TableHead>Method</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              {canViewAll && <TableHead>Recorded by</TableHead>}
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={canViewAll ? 8 : 7}>
                  <Skeleton className="h-32 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!listQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canViewAll ? 8 : 7} className="py-12 text-center text-sm text-[#22264B]/50">
                  No payments here yet.{canRecord && " Record your first one above."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <button type="button" onClick={() => setDetailId(p.id)} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {p.reference}
                  </button>
                  <span className="block text-xs text-[#22264B]/45">{formatDateTime(p.createdAt)}</span>
                </TableCell>
                <TableCell className="text-sm">{PAYMENT_TYPE_LABELS[p.paymentType]}</TableCell>
                <TableCell className="text-sm">
                  {p.customerName ?? <span className="text-[#22264B]/40">Walk-in</span>}
                  {p.orderNo && <span className="block text-xs text-[#22264B]/45">{p.orderNo}</span>}
                </TableCell>
                <TableCell className="text-sm">{METHOD_LABELS[p.method] ?? p.method}</TableCell>
                <TableCell className={`text-right font-bold ${p.paymentType === "DEPOSIT_REFUND" ? "text-red-600" : "text-[#22264B]"}`}>
                  {p.paymentType === "DEPOSIT_REFUND" ? "−" : ""}{formatMoney(p.amount)}
                </TableCell>
                {canViewAll && <TableCell className="text-sm">{p.recorderName}</TableCell>}
                <TableCell>
                  <Badge variant="outline" className={STATUS_STYLES[p.status]}>
                    {p.status === "PENDING_APPROVAL" ? "Pending" : p.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => setDetailId(p.id)}>Open</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <RecordPaymentDialog open={recordOpen} onClose={() => setRecordOpen(false)} />
      <PaymentDetailDialog paymentId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
