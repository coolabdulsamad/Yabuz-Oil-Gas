import { useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, CheckCircle2, PackageCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { formatDate, formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
 * YABUZ OIL & GAS — purchase order detail.
 * Approve, receive deliveries (full or partial — each receipt writes
 * PURCHASE_IN movements) and cancel.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING: "border-amber-600/30 bg-amber-50 text-amber-700",
  APPROVED: "border-sky-600/30 bg-sky-50 text-sky-700",
  PARTIALLY_RECEIVED: "border-violet-600/30 bg-violet-50 text-violet-700",
  RECEIVED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
};

export default function PurchaseDetail() {
  const { id } = useParams();
  const poId = Number(id);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const utils = trpc.useUtils();
  const poQuery = trpc.purchases.getById.useQuery({ id: poId });
  const po = poQuery.data;

  const invalidate = () => {
    utils.purchases.getById.invalidate({ id: poId });
    utils.purchases.list.invalidate();
    utils.inventory.overview.invalidate();
    utils.inventory.movements.invalidate();
    utils.products.list.invalidate();
  };

  const approve = trpc.purchases.approve.useMutation({
    onSuccess: () => {
      toast.success("Purchase order approved.");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.purchases.cancel.useMutation({
    onSuccess: () => {
      toast.success("Purchase order cancelled.");
      setCancelOpen(false);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (poQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-80 rounded-xl" />
      </div>
    );
  }
  if (!po) return <p className="text-sm text-[#22264B]/60">Purchase order not found.</p>;

  const canApprove = po.status === "PENDING";
  const canReceive = po.status === "APPROVED" || po.status === "PARTIALLY_RECEIVED";
  const canCancel = po.status === "PENDING" || po.status === "APPROVED";
  const receivedPct =
    po.items.reduce((s, i) => s + i.quantity, 0) > 0
      ? Math.round(
          (po.items.reduce((s, i) => s + i.receivedQty, 0) / po.items.reduce((s, i) => s + i.quantity, 0)) * 100,
        )
      : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon">
            <Link to="/purchases">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-[#22264B]">{po.reference}</h2>
              <Badge variant="outline" className={STATUS_STYLES[po.status] ?? ""}>
                {po.status.replaceAll("_", " ")}
              </Badge>
            </div>
            <p className="text-sm text-[#22264B]/55">
              {po.supplierName ?? "No supplier"} · created {formatDateTime(po.createdAt)} by{" "}
              {po.createdByName ?? "—"}
              {po.expectedAt ? ` · expected ${formatDate(po.expectedAt)}` : ""}
              {po.receivedAt ? ` · fully received ${formatDateTime(po.receivedAt)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canApprove && (
            <Button
              onClick={() => approve.mutate({ id: poId })}
              disabled={approve.isPending}
              className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
            >
              <CheckCircle2 className="size-4" /> {approve.isPending ? "Approving…" : "Approve Order"}
            </Button>
          )}
          {canReceive && (
            <Button
              onClick={() => setReceiveOpen(true)}
              className="bg-[#F7A026] text-[#22264B] hover:bg-[#F7A026]/90"
            >
              <PackageCheck className="size-4" /> Receive Stock
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              <XCircle className="size-4" /> Cancel Order
            </Button>
          )}
        </div>
      </div>

      {/* Progress + totals */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Lines</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{po.items.length}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Order total</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{formatMoney(po.totalCost)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Received</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{receivedPct}%</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Contact</p>
          <p className="mt-1 text-sm font-semibold text-[#22264B]">{po.supplierPhone ?? "—"}</p>
        </div>
      </div>

      {po.notes && (
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 text-sm text-[#22264B]/70 shadow-sm">
          <span className="font-bold text-[#22264B]">Notes: </span>
          {po.notes}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Ordered</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="text-right">Line total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {po.items.map((i) => {
              const outstanding = i.quantity - i.receivedQty;
              return (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link to={`/products/${i.productId}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                      {i.productName}
                    </Link>
                    <span className="block text-xs text-[#22264B]/45">{i.sku} · {i.packDescription}</span>
                  </TableCell>
                  <TableCell className="text-right text-sm">{formatQty(i.quantity)}</TableCell>
                  <TableCell className={`text-right text-sm font-semibold ${i.receivedQty >= i.quantity ? "text-emerald-600" : "text-[#22264B]"}`}>
                    {formatQty(i.receivedQty)}
                  </TableCell>
                  <TableCell className={`text-right text-sm ${outstanding > 0 ? "text-amber-600" : "text-[#22264B]/40"}`}>
                    {formatQty(outstanding)}
                  </TableCell>
                  <TableCell className="text-right text-sm">{formatMoney(i.unitCost)}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(i.lineTotal)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {canReceive && <ReceiveDialog poId={poId} open={receiveOpen} onClose={() => setReceiveOpen(false)} />}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel {po.reference}?</AlertDialogTitle>
            <AlertDialogDescription>
              This marks the order as cancelled. No stock is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5 py-2">
            <Label>Reason</Label>
            <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Why is this order being cancelled?" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancel.mutate({ id: poId, reason: cancelReason.trim() })}
              disabled={cancelReason.trim().length < 3 || cancel.isPending}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {cancel.isPending ? "Cancelling…" : "Cancel order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------ RECEIVE DIALOG ------------------------------ */

function ReceiveDialog({ poId, open, onClose }: { poId: number; open: boolean; onClose: () => void }) {
  const [formKey, setFormKey] = useState("closed");
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState("");

  const sessionKey = open ? "open" : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setQtys({});
    setNotes("");
  }

  const utils = trpc.useUtils();
  const poQuery = trpc.purchases.getById.useQuery({ id: poId }, { enabled: open });
  const po = poQuery.data;

  const receive = trpc.purchases.receive.useMutation({
    onSuccess: (r) => {
      toast.success(`Stock received — order is now ${r.status.replaceAll("_", " ")}.`);
      utils.purchases.getById.invalidate({ id: poId });
      utils.purchases.list.invalidate();
      utils.inventory.overview.invalidate();
      utils.inventory.movements.invalidate();
      utils.products.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const outstandingLines = (po?.items ?? []).filter((i) => i.quantity - i.receivedQty > 0);
  const arrivals = outstandingLines
    .map((i) => ({ itemId: i.id, quantity: Number(qtys[i.id] ?? "0") }))
    .filter((a) => a.quantity > 0);

  const anyInvalid = outstandingLines.some((i) => {
    const v = qtys[i.id];
    return v !== undefined && v !== "" && Number(v) > i.quantity - i.receivedQty;
  });

  const fillAll = () => {
    const next: Record<number, string> = {};
    for (const i of outstandingLines) next[i.id] = String(i.quantity - i.receivedQty);
    setQtys(next);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">Receive Stock — {po?.reference}</DialogTitle>
          <DialogDescription>
            Enter the quantities arriving in this delivery. They go straight into inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={fillAll}>
              Fill remaining on all lines
            </Button>
          </div>
          {outstandingLines.length === 0 && (
            <p className="py-6 text-center text-sm text-[#22264B]/50">
              Everything on this order has already been received.
            </p>
          )}
          {outstandingLines.map((i) => {
            const outstanding = i.quantity - i.receivedQty;
            const v = qtys[i.id] ?? "";
            const tooMuch = v !== "" && Number(v) > outstanding;
            return (
              <div key={i.id} className="flex items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[#22264B]">{i.productName}</p>
                  <p className="text-xs text-[#22264B]/45">
                    outstanding {formatQty(outstanding)} of {formatQty(i.quantity)} ordered
                  </p>
                </div>
                <Input
                  type="number"
                  min="0"
                  max={outstanding}
                  step="any"
                  value={v}
                  onChange={(e) => setQtys((prev) => ({ ...prev, [i.id]: e.target.value }))}
                  className={`w-28 text-right ${tooMuch ? "border-red-500" : ""}`}
                  placeholder="0"
                />
              </div>
            );
          })}
          <div className="space-y-1.5">
            <Label>
              Delivery notes <span className="text-[#22264B]/40">(optional)</span>
            </Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={receive.isPending}>
            Close
          </Button>
          <Button
            onClick={() => receive.mutate({ id: poId, items: arrivals, notes: notes.trim() })}
            disabled={arrivals.length === 0 || anyInvalid || receive.isPending}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {receive.isPending ? "Receiving…" : `Receive ${arrivals.length} line(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
