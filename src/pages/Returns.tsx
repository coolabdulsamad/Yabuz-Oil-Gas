import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Loader2, Plus, RotateCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
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
 * YABUZ OIL & GAS — sales returns.
 * Return some items — or every item — of a completed sale. On approval
 * the stock goes back in and the value lands in the customer's advance
 * deposit wallet (outstanding credit is cleared first). Refunds then
 * happen from the Deposits module.
 */

const STATUS_STYLES: Record<string, string> = {
  PENDING_APPROVAL: "border-amber-600/30 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
  CANCELLED: "border-gray-500/30 bg-gray-100 text-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "Pending approval",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

/* ------------------------------ CREATE DIALOG ------------------------------ */

function NewReturnDialog({
  open,
  saleId,
  onClose,
  onDone,
}: {
  open: boolean;
  saleId: number | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [saleSearch, setSaleSearch] = useState("");
  const [pickedSaleId, setPickedSaleId] = useState<number | null>(saleId);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [restock, setRestock] = useState(true);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const salesQuery = trpc.sales.list.useQuery({ status: "COMPLETED" }, { enabled: open && !saleId });
  const itemsQuery = trpc.returns.saleItems.useQuery({ saleId: pickedSaleId! }, { enabled: open && pickedSaleId != null });

  useEffect(() => {
    if (open) {
      setPickedSaleId(saleId);
      setQty({});
      setReason("");
      setNotes("");
      setRestock(true);
    }
  }, [open, saleId]);

  const lines = useMemo(() => (itemsQuery.data?.lines ?? []).filter((l) => l.returnableQty > 0), [itemsQuery.data]);
  const total = lines.reduce((s, l) => s + (qty[l.id] ?? 0) * l.unitPrice, 0);
  const picked = lines.filter((l) => (qty[l.id] ?? 0) > 0);

  const create = trpc.returns.create.useMutation({
    onSuccess: (r) => {
      toast.success(r.outcome === "COMPLETED" ? `Return ${r.reference} completed — value is in the customer's deposit wallet.` : `Return ${r.reference} submitted for approval.`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function submit() {
    if (!pickedSaleId) return;
    if (picked.length === 0) return toast.error("Enter a return quantity for at least one item.");
    if (reason.trim().length < 3) return toast.error("Give a reason for the return.");
    create.mutate({
      saleId: pickedSaleId,
      items: picked.map((l) => ({ saleItemId: l.id, quantity: qty[l.id] })),
      restock,
      reason: reason.trim(),
      notes: notes.trim() || undefined,
    });
  }

  const completedSales = (salesQuery.data ?? []).filter((s) =>
    saleSearch.trim()
      ? s.orderNo.toLowerCase().includes(saleSearch.toLowerCase()) ||
        (s.customerName ?? "").toLowerCase().includes(saleSearch.toLowerCase())
      : true,
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] w-[95vw] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New return</DialogTitle>
          <DialogDescription>
            Returned value goes into the customer's advance deposit wallet — refundable from Deposits.
          </DialogDescription>
        </DialogHeader>

        {!pickedSaleId ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-[#22264B]/40" />
              <Input className="pl-9" placeholder="Search completed sales by order no or customer…" value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} />
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-[#22264B]/10 p-1">
              {salesQuery.isLoading && <Skeleton className="h-20 w-full" />}
              {completedSales.slice(0, 30).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setPickedSaleId(s.id)}
                  className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-[#F7A026]/10"
                >
                  <span>
                    <span className="font-bold text-[#22264B]">{s.orderNo}</span>
                    <span className="ml-2 text-[#22264B]/55">{s.customerName ?? "Walk-in"}</span>
                  </span>
                  <span className="font-semibold text-[#22264B]">{formatMoney(s.grandTotal)}</span>
                </button>
              ))}
              {!salesQuery.isLoading && completedSales.length === 0 && (
                <p className="p-4 text-center text-sm text-[#22264B]/50">No completed sales found.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg bg-[#22264B]/5 px-3 py-2 text-sm">
              <span>
                <span className="font-bold text-[#22264B]">{itemsQuery.data?.sale.orderNo}</span>
                <span className="ml-2 text-[#22264B]/55">{itemsQuery.data?.customer?.fullName ?? "Walk-in customer"}</span>
                {itemsQuery.data?.customer && (
                  <span className="ml-2 text-xs text-[#22264B]/45">
                    wallet {formatMoney(itemsQuery.data.customer.depositBalance)} · owes {formatMoney(itemsQuery.data.customer.creditOutstanding)}
                  </span>
                )}
              </span>
              {!saleId && (
                <Button size="sm" variant="ghost" onClick={() => setPickedSaleId(null)}>Change</Button>
              )}
            </div>

            {itemsQuery.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : lines.length === 0 ? (
              <p className="rounded-lg border border-dashed border-[#22264B]/20 p-6 text-center text-sm text-[#22264B]/50">
                Everything on this sale has already been returned.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
                    <TableHead className="text-right">Returnable</TableHead>
                    <TableHead className="text-right">Unit price</TableHead>
                    <TableHead className="w-28 text-right">Return qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <p className="font-medium text-[#22264B]">{l.productName}</p>
                        <p className="text-xs text-[#22264B]/50">{l.sku} · {l.soldAsUnits ? "units" : "packs"}</p>
                      </TableCell>
                      <TableCell className="text-right">{formatQty(l.quantity)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatQty(l.returnableQty)}</TableCell>
                      <TableCell className="text-right">{formatMoney(l.unitPrice)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={l.returnableQty}
                          step={l.soldAsUnits ? 1 : 0.5}
                          value={qty[l.id] ?? ""}
                          onChange={(e) => {
                            const v = Math.min(Number(e.target.value) || 0, l.returnableQty);
                            setQty((q) => ({ ...q, [l.id]: v }));
                          }}
                          className="h-8 text-right"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Reason *</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer changed mind / wrong item" />
              </div>
              <div className="flex items-end gap-3 pb-1">
                <Switch checked={restock} onCheckedChange={setRestock} id="restock" />
                <Label htmlFor="restock" className="cursor-pointer">
                  Put items back into stock
                  <span className="block text-xs font-normal text-[#22264B]/50">Off = damaged / write-off</span>
                </Label>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>

            <div className="flex items-center justify-between rounded-xl bg-[#22264B] px-4 py-3 text-white">
              <span className="text-sm font-medium">Return value → deposit wallet</span>
              <span className="text-lg font-black">{formatMoney(total)}</span>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={create.isPending || !pickedSaleId || picked.length === 0}>
            {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Submit return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ DETAIL DIALOG ------------------------------ */

function ReturnDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const q = trpc.returns.getById.useQuery({ id });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Return {d?.ret.reference}
            {d && <Badge variant="outline" className={STATUS_STYLES[d.ret.status]}>{STATUS_LABELS[d.ret.status]}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {d ? `${d.orderNo} · ${d.customer?.fullName ?? "Walk-in"} · ${formatDateTime(d.ret.createdAt)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {!d ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p className="font-medium">{i.productName}</p>
                      <p className="text-xs text-[#22264B]/50">{i.sku}</p>
                    </TableCell>
                    <TableCell className="text-right">{formatQty(i.quantity)}</TableCell>
                    <TableCell className="text-right">{formatMoney(i.unitPrice)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(i.lineTotal)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="space-y-1 rounded-lg bg-[#22264B]/5 p-3 text-sm">
              <p><span className="font-semibold">Reason:</span> {d.ret.reason}</p>
              <p><span className="font-semibold">Stock:</span> {d.ret.restock ? "Returned to stock" : "Not restocked (write-off)"}</p>
              <p><span className="font-semibold">Processed by:</span> {d.processorName}{d.approverName ? ` · Approved by ${d.approverName}` : ""}</p>
              {d.ret.rejectedReason && <p className="text-red-600"><span className="font-semibold">Rejected:</span> {d.ret.rejectedReason}</p>}
              {d.ret.notes && <p className="text-[#22264B]/60">{d.ret.notes}</p>}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-[#22264B] px-4 py-3 text-white">
              <span className="text-sm font-medium">{d.ret.status === "COMPLETED" ? "Credited to deposit wallet" : "Return value"}</span>
              <span className="text-lg font-black">{formatMoney(d.ret.totalAmount)}</span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- PAGE --------------------------------- */

export default function Returns() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("returns.create");
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaleId, setCreateSaleId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listQuery = trpc.returns.list.useQuery({ status: status === "ALL" ? undefined : (status as never) });

  // Deep link: /returns/new?sale=123 opens the create dialog for that sale.
  useEffect(() => {
    if (searchParams.get("sale")) {
      setCreateSaleId(Number(searchParams.get("sale")));
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const rows = (listQuery.data ?? []).filter((r) =>
    search.trim()
      ? r.reference.toLowerCase().includes(search.toLowerCase()) ||
        r.orderNo.toLowerCase().includes(search.toLowerCase()) ||
        (r.customerName ?? "").toLowerCase().includes(search.toLowerCase())
      : true,
  );
  const totals = useMemo(() => {
    const completed = (listQuery.data ?? []).filter((r) => r.status === "COMPLETED");
    return {
      count: listQuery.data?.length ?? 0,
      pending: (listQuery.data ?? []).filter((r) => r.status === "PENDING_APPROVAL").length,
      value: completed.reduce((s, r) => s + r.totalAmount, 0),
    };
  }, [listQuery.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Sales Returns</h2>
          <p className="text-sm text-[#22264B]/55">
            Returned items go back to stock; the value lands in the customer's advance deposit wallet.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => { setCreateSaleId(null); setCreateOpen(true); }}>
            <Plus className="mr-2 size-4" /> New return
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Returns</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{totals.count}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Awaiting approval</p>
          <p className="mt-1 text-xl font-black text-amber-600">{totals.pending}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Value returned</p>
          <p className="mt-1 text-xl font-black text-emerald-600">{formatMoney(totals.value)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-2.5 left-3 size-4 text-[#22264B]/40" />
          <Input className="pl-9" placeholder="Search reference, order no or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="REJECTED">Rejected</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        {listQuery.isLoading ? (
          <div className="space-y-2 p-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-10 text-center">
            <RotateCcw className="size-8 text-[#22264B]/20" />
            <p className="text-sm text-[#22264B]/50">No returns yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Sale</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Processed by</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                  <TableCell className="font-bold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell>{r.orderNo}</TableCell>
                  <TableCell>{r.customerName ?? "Walk-in"}</TableCell>
                  <TableCell className="text-right font-semibold">{formatMoney(r.totalAmount)}</TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_STYLES[r.status]}>{STATUS_LABELS[r.status]}</Badge></TableCell>
                  <TableCell className="text-[#22264B]/70">{r.processorName}</TableCell>
                  <TableCell className="text-[#22264B]/60">{formatDateTime(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <NewReturnDialog
        open={createOpen}
        saleId={createSaleId}
        onClose={() => setCreateOpen(false)}
        onDone={() => listQuery.refetch()}
      />
      {detailId != null && <ReturnDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
