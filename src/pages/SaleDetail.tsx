import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Ban, Loader2, Pause, Pencil, Play, Send } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { PAYMENT_MODE_LABELS, SALE_PAYMENT_STYLES, SALE_STATUS_LABELS, SALE_STATUS_STYLES } from "@/pages/Sales";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — sale details.
 * Full snapshot: lines, totals, settlement mode, approval trail and the
 * actions valid for the sale's current state.
 */

export default function SaleDetail() {
  const { id } = useParams();
  const saleId = Number(id);
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { hasPermission } = useAuth();
  const canHold = hasPermission("sales.hold");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const query = trpc.sales.getById.useQuery({ id: saleId });
  const data = query.data;

  const invalidate = async () => {
    await utils.sales.getById.invalidate({ id: saleId });
    await utils.sales.list.invalidate();
  };
  const submitMutation = trpc.sales.submit.useMutation({
    onSuccess: async (r) => {
      toast.success(r.outcome === "COMPLETED" ? "Sale completed." : "Sale submitted for approval.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const holdMutation = trpc.sales.hold.useMutation({
    onSuccess: async () => {
      toast.success("Sale put on hold.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const resumeMutation = trpc.sales.resume.useMutation({
    onSuccess: async () => {
      toast.success("Sale resumed — back to draft.");
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancelMutation = trpc.sales.cancel.useMutation({
    onSuccess: async () => {
      toast.success("Sale cancelled.");
      setCancelOpen(false);
      await invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const busy = submitMutation.isPending || holdMutation.isPending || resumeMutation.isPending || cancelMutation.isPending;

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-[#22264B]/60">Sale not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/sales">Back to sales</Link>
        </Button>
      </div>
    );
  }

  const { sale, items, customer, repName, approverName, cancellerName, approvalRequest, canManage, canCancel } = data;
  const canActDraft = canManage && (sale.status === "DRAFT" || sale.status === "ON_HOLD");
  const showCancel =
    sale.status !== "CANCELLED" &&
    ((canManage && ["DRAFT", "ON_HOLD", "PENDING_APPROVAL", "REJECTED"].includes(sale.status)) || canCancel);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="outline" size="icon">
          <Link to="/sales">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-black tracking-tight text-[#22264B]">{sale.orderNo}</h2>
            <Badge variant="outline" className={SALE_STATUS_STYLES[sale.status]}>
              {SALE_STATUS_LABELS[sale.status] ?? sale.status}
            </Badge>
            <Badge variant="outline" className={SALE_PAYMENT_STYLES[sale.paymentStatus]}>
              {sale.paymentStatus}
            </Badge>
            <Badge variant="outline" className="border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/70">
              {PAYMENT_MODE_LABELS[sale.paymentMode]}
            </Badge>
          </div>
          <p className="text-sm text-[#22264B]/55">Created {formatDateTime(sale.createdAt)} by {repName}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canActDraft && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => navigate(`/sales/${sale.id}/edit`)}>
                <Pencil className="mr-1 size-4" /> Edit
              </Button>
              {sale.status === "DRAFT" && canHold && (
                <Button variant="outline" disabled={busy} onClick={() => holdMutation.mutate({ saleId: sale.id })}>
                  <Pause className="mr-1 size-4" /> Hold
                </Button>
              )}
              {sale.status === "ON_HOLD" && canHold && (
                <Button variant="outline" disabled={busy} onClick={() => resumeMutation.mutate({ saleId: sale.id })}>
                  <Play className="mr-1 size-4" /> Resume
                </Button>
              )}
              <Button
                className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]"
                disabled={busy}
                onClick={() => submitMutation.mutate({ saleId: sale.id })}
              >
                {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Send className="mr-1 size-4" />}
                Submit
              </Button>
            </>
          )}
          {showCancel && (
            <Button variant="outline" className="text-red-600 hover:bg-red-50" disabled={busy} onClick={() => setCancelOpen(true)}>
              <Ban className="mr-1 size-4" /> Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Meta cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Customer</p>
          {customer ? (
            <Link to={`/customers/${customer.id}`} className="mt-1 block font-bold text-[#22264B] hover:text-[#F7A026]">
              {customer.fullName}
              <span className="block text-xs font-normal text-[#22264B]/45">{customer.code}</span>
            </Link>
          ) : (
            <p className="mt-1 font-bold text-[#22264B]">Walk-in</p>
          )}
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Grand total</p>
          <p className="mt-1 text-lg font-black text-[#F7A026]">{formatMoney(sale.grandTotal)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Paid</p>
          <p className="mt-1 font-bold text-emerald-700">{formatMoney(sale.amountPaid)}</p>
          <p className="text-xs text-[#22264B]/45">Balance {formatMoney(sale.balanceDue)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Timeline</p>
          <p className="mt-1 text-xs text-[#22264B]/70">
            {sale.submittedAt && <>Submitted {formatDateTime(sale.submittedAt)}<br /></>}
            {sale.completedAt && <>Completed {formatDateTime(sale.completedAt)}<br /></>}
            {sale.cancelledAt && <>Cancelled {formatDateTime(sale.cancelledAt)}</>}
            {!sale.submittedAt && !sale.completedAt && !sale.cancelledAt && "Not submitted yet"}
          </p>
        </div>
      </div>

      {/* Approval / rejection context */}
      {approvalRequest && (
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Approval request</p>
              <p className="mt-1 text-sm text-[#22264B]">
                Status:{" "}
                <Badge variant="outline" className={SALE_STATUS_STYLES[approvalRequest.status] ?? "border-[#22264B]/20"}>
                  {approvalRequest.status}
                </Badge>{" "}
                · step {approvalRequest.currentStep} of {approvalRequest.totalSteps}
                {approverName && <> · final approval by {approverName}</>}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/approvals">Open approvals</Link>
            </Button>
          </div>
        </div>
      )}
      {sale.status === "CANCELLED" && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-700">Cancelled{cancellerName ? ` by ${cancellerName}` : ""}</p>
          <p className="text-sm text-red-600">{sale.cancelReason}</p>
        </div>
      )}

      {/* Items */}
      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Product</TableHead>
              <TableHead>Sold as</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Discount</TableHead>
              <TableHead className="text-right">Stock out</TableHead>
              <TableHead className="text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <span className="block text-sm font-semibold text-[#22264B]">{i.productName}</span>
                  <span className="block text-xs text-[#22264B]/45">{i.sku} · {i.packDescription}</span>
                </TableCell>
                <TableCell className="text-sm">{i.soldAsUnits ? "Inner units" : "Whole packs"}</TableCell>
                <TableCell className="text-right text-sm">{formatQty(i.quantity)}</TableCell>
                <TableCell className="text-right text-sm">{formatMoney(i.unitPrice)}</TableCell>
                <TableCell className="text-right text-sm">{i.discountAmount > 0 ? formatMoney(i.discountAmount) : "—"}</TableCell>
                <TableCell className="text-right text-sm">{formatQty(i.packsDeducted)} packs</TableCell>
                <TableCell className="text-right text-sm font-bold text-[#22264B]">{formatMoney(i.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="space-y-1 border-t border-[#22264B]/10 px-4 py-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#22264B]/60">Subtotal</span>
            <span className="font-semibold text-[#22264B]">{formatMoney(sale.subtotal)}</span>
          </div>
          {sale.discountTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-[#22264B]/60">
                Discount{sale.discountNote ? ` (${sale.discountNote})` : ""}
              </span>
              <span className="font-semibold text-red-600">−{formatMoney(sale.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-[#22264B]/10 pt-2">
            <span className="font-bold text-[#22264B]">Grand total</span>
            <span className="text-base font-black text-[#F7A026]">{formatMoney(sale.grandTotal)}</span>
          </div>
        </div>
      </div>

      {sale.notes && sale.notes.replace(/\[mode:[A-Z_]+\]\s?/, "").trim() && (
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Notes</p>
          <p className="mt-1 text-sm whitespace-pre-wrap text-[#22264B]/80">
            {sale.notes.replace(/\[mode:[A-Z_]+\]\s?/, "")}
          </p>
        </div>
      )}

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel {sale.orderNo}?</DialogTitle>
            <DialogDescription>
              {sale.status === "COMPLETED"
                ? "Stock will be returned and any wallet effects reversed. This can't be undone."
                : sale.status === "PENDING_APPROVAL"
                  ? "The pending approval request will be withdrawn."
                  : "The sale will be marked cancelled."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this sale being cancelled?"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep sale</Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length < 3 || cancelMutation.isPending}
              onClick={() => cancelMutation.mutate({ saleId: sale.id, reason: cancelReason.trim() })}
            >
              {cancelMutation.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
              Cancel sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
