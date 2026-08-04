import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { ArrowLeftRight, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { ProofUpload, type ProofValue } from "@/components/payments/ProofUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * YABUZ OIL & GAS — sales exchanges.
 * Swap items from a completed sale for different items:
 *  - new items cost MORE → customer tops up (cash / transfer / POS /
 *    cheque / deposit wallet / outstanding credit)
 *  - new items cost LESS → difference credited to the deposit wallet
 *    (refundable later from the Deposits module)
 *  - equal value → straight swap
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

const SETTLEMENT_LABELS: Record<string, string> = {
  NONE: "Straight swap (no payment)",
  TOPUP_CASH: "Top-up by cash",
  TOPUP_TRANSFER: "Top-up by bank transfer",
  TOPUP_POS: "Top-up by POS",
  TOPUP_CHEQUE: "Top-up by cheque",
  TOPUP_DEPOSIT: "Top-up from deposit wallet",
  TOPUP_CREDIT: "Top-up on credit (customer owes)",
  TO_DEPOSIT: "Credit difference to deposit wallet",
};

type Settlement =
  | "NONE"
  | "TOPUP_CASH"
  | "TOPUP_TRANSFER"
  | "TOPUP_POS"
  | "TOPUP_CHEQUE"
  | "TOPUP_DEPOSIT"
  | "TOPUP_CREDIT"
  | "TO_DEPOSIT";

interface NewLine {
  productId: number;
  name: string;
  sku: string;
  soldAsUnits: boolean;
  allowUnitSales: boolean;
  unitsPerPack: number;
  quantity: number;
  unitPrice: number;
  stock: number;
}

/* ------------------------------ CREATE DIALOG ------------------------------ */

function NewExchangeDialog({
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
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [newLines, setNewLines] = useState<NewLine[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [settlement, setSettlement] = useState<Settlement>("NONE");
  const [externalRef, setExternalRef] = useState("");
  const [proof, setProof] = useState<ProofValue | null>(null);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  const salesQuery = trpc.sales.list.useQuery({ status: "COMPLETED" }, { enabled: open && !saleId });
  const dataQuery = trpc.exchanges.saleItems.useQuery({ saleId: pickedSaleId! }, { enabled: open && pickedSaleId != null });

  useEffect(() => {
    if (open) {
      setPickedSaleId(saleId);
      setReturnQty({});
      setNewLines([]);
      setSettlement("NONE");
      setExternalRef("");
      setProof(null);
      setReason("");
      setNotes("");
    }
  }, [open, saleId]);

  const returnable = useMemo(() => (dataQuery.data?.lines ?? []).filter((l) => l.returnableQty > 0), [dataQuery.data]);
  const returnedTotal = returnable.reduce((s, l) => s + (returnQty[l.id] ?? 0) * l.unitPrice, 0);
  const newTotal = newLines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const difference = Number((newTotal - returnedTotal).toFixed(2));
  const customer = dataQuery.data?.customer ?? null;

  // Auto-suggest the settlement when the difference changes.
  useEffect(() => {
    if (difference > 0) setSettlement((s) => (s.startsWith("TOPUP") ? s : "TOPUP_CASH"));
    else if (difference < 0) setSettlement("TO_DEPOSIT");
    else setSettlement("NONE");
  }, [difference]);

  const create = trpc.exchanges.create.useMutation({
    onSuccess: (r) => {
      toast.success(r.outcome === "COMPLETED" ? `Exchange ${r.reference} completed.` : `Exchange ${r.reference} submitted for approval.`);
      onDone();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function addProduct(p: NonNullable<typeof dataQuery.data>["catalog"][number]) {
    if (newLines.some((l) => l.productId === p.id)) {
      return toast.error("That product is already in the new items list — adjust its quantity.");
    }
    setNewLines((ls) => [
      ...ls,
      {
        productId: p.id,
        name: p.name,
        sku: p.sku,
        soldAsUnits: false,
        allowUnitSales: p.allowUnitSales,
        unitsPerPack: p.unitsPerPack,
        quantity: 1,
        unitPrice: p.sellCartonPrice,
        stock: p.currentStock,
      },
    ]);
  }

  function updateLine(productId: number, patch: Partial<NewLine>) {
    setNewLines((ls) =>
      ls.map((l) => {
        if (l.productId !== productId) return l;
        const next = { ...l, ...patch };
        next.unitPrice = next.soldAsUnits
          ? (dataQuery.data?.catalog.find((c) => c.id === productId)?.sellUnitPrice ?? next.unitPrice)
          : (dataQuery.data?.catalog.find((c) => c.id === productId)?.sellCartonPrice ?? next.unitPrice);
        return next;
      }),
    );
  }

  function submit() {
    if (!pickedSaleId) return;
    const returned = returnable.filter((l) => (returnQty[l.id] ?? 0) > 0);
    if (returned.length === 0) return toast.error("Enter a quantity for at least one returned item.");
    if (newLines.length === 0) return toast.error("Add at least one new item.");
    if (reason.trim().length < 3) return toast.error("Give a reason for the exchange.");
    create.mutate({
      saleId: pickedSaleId,
      returnedItems: returned.map((l) => ({ saleItemId: l.id, quantity: returnQty[l.id] })),
      newItems: newLines.map((l) => ({ productId: l.productId, soldAsUnits: l.soldAsUnits, quantity: l.quantity })),
      settlementType: settlement,
      externalReference: externalRef.trim() || undefined,
      proofUrl: proof?.url,
      proofPublicId: proof?.publicId,
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
  const catalog = (dataQuery.data?.catalog ?? []).filter((p) =>
    catalogSearch.trim()
      ? p.name.toLowerCase().includes(catalogSearch.toLowerCase()) || p.sku.toLowerCase().includes(catalogSearch.toLowerCase())
      : true,
  );
  const needsProof = settlement === "TOPUP_TRANSFER" || settlement === "TOPUP_POS" || settlement === "TOPUP_CHEQUE";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[94vh] w-[95vw] max-w-6xl overflow-x-hidden overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New exchange</DialogTitle>
          <DialogDescription>
            Take items back from a completed sale and give new ones — the difference is topped up or credited to the deposit wallet.
          </DialogDescription>
        </DialogHeader>

        {!pickedSaleId ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute top-2.5 left-3 size-4 text-[#22264B]/40" />
              <Input className="pl-9" placeholder="Search completed sales…" value={saleSearch} onChange={(e) => setSaleSearch(e.target.value)} />
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-[#22264B]/10 p-1">
              {salesQuery.isLoading && <Skeleton className="h-20 w-full" />}
              {completedSales.slice(0, 30).map((s) => (
                <button key={s.id} onClick={() => setPickedSaleId(s.id)} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-[#F7A026]/10">
                  <span>
                    <span className="font-bold text-[#22264B]">{s.orderNo}</span>
                    <span className="ml-2 text-[#22264B]/55">{s.customerName ?? "Walk-in"}</span>
                  </span>
                  <span className="font-semibold text-[#22264B]">{formatMoney(s.grandTotal)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : dataQuery.isLoading ? (
          <Skeleton className="h-60 w-full" />
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between rounded-lg bg-[#22264B]/5 px-3 py-2 text-sm">
              <span>
                <span className="font-bold text-[#22264B]">{dataQuery.data?.sale.orderNo}</span>
                <span className="ml-2 text-[#22264B]/55">{customer?.fullName ?? "Walk-in customer"}</span>
                {customer && (
                  <span className="ml-2 text-xs text-[#22264B]/45">
                    wallet {formatMoney(customer.depositBalance)} · owes {formatMoney(customer.creditOutstanding)}
                  </span>
                )}
              </span>
              {!saleId && <Button size="sm" variant="ghost" onClick={() => setPickedSaleId(null)}>Change</Button>}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
            {/* Returned items */}
            <div className="min-w-0">
              <h3 className="mb-2 text-sm font-bold tracking-wide text-[#22264B] uppercase">1 · Items the customer returns</h3>
              {returnable.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[#22264B]/20 p-4 text-center text-sm text-[#22264B]/50">
                  Nothing left to take back on this sale.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Returnable</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead className="w-36 text-right">Qty back</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {returnable.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>
                          <p className="font-medium text-[#22264B]">{l.productName}</p>
                          <p className="text-xs text-[#22264B]/50">{l.sku}</p>
                        </TableCell>
                        <TableCell className="text-right">{formatQty(l.returnableQty)}</TableCell>
                        <TableCell className="text-right">{formatMoney(l.unitPrice)}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            max={l.returnableQty}
                            step={l.soldAsUnits ? 1 : 0.5}
                            value={returnQty[l.id] ?? ""}
                            onChange={(e) => {
                              const v = Math.min(Number(e.target.value) || 0, l.returnableQty);
                              setReturnQty((q) => ({ ...q, [l.id]: v }));
                            }}
                            className="h-10 w-28 min-w-[7rem] text-center text-base font-bold"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-1 text-right text-sm font-semibold text-[#22264B]">Returned value: {formatMoney(returnedTotal)}</p>
            </div>

            {/* New items */}
            <div>
              <h3 className="mb-2 text-sm font-bold tracking-wide text-[#22264B] uppercase">2 · New items the customer takes</h3>
              <div className="mb-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Search className="absolute top-2.5 left-3 size-4 text-[#22264B]/40" />
                  <Input className="pl-9" placeholder="Search products to add…" value={catalogSearch} onChange={(e) => setCatalogSearch(e.target.value)} />
                </div>
              </div>
              {catalogSearch.trim() && (
                <div className="mb-2 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[#22264B]/10 p-1">
                  {catalog.slice(0, 12).map((p) => (
                    <button key={p.id} onClick={() => { addProduct(p); setCatalogSearch(""); }} className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-left text-sm hover:bg-[#F7A026]/10">
                      <span>{p.name} <span className="text-xs text-[#22264B]/45">({p.sku} · stock {formatQty(p.currentStock)})</span></span>
                      <span className="font-semibold">{formatMoney(p.sellCartonPrice)}</span>
                    </button>
                  ))}
                  {catalog.length === 0 && <p className="p-3 text-center text-sm text-[#22264B]/50">No products match.</p>}
                </div>
              )}
              {newLines.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Sell as</TableHead>
                      <TableHead className="w-32 text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newLines.map((l) => (
                      <TableRow key={l.productId}>
                        <TableCell>
                          <p className="font-medium text-[#22264B]">{l.name}</p>
                          <p className="text-xs text-[#22264B]/50">{l.sku} · stock {formatQty(l.stock)} packs</p>
                        </TableCell>
                        <TableCell>
                          {l.allowUnitSales ? (
                            <Select value={l.soldAsUnits ? "units" : "packs"} onValueChange={(v) => updateLine(l.productId, { soldAsUnits: v === "units" })}>
                              <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="packs">Packs</SelectItem>
                                <SelectItem value="units">Units</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-[#22264B]/50">Packs</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0.5}
                            step={l.soldAsUnits ? 1 : 0.5}
                            value={l.quantity}
                            onChange={(e) => updateLine(l.productId, { quantity: Number(e.target.value) || 0 })}
                            className="h-10 w-28 min-w-[7rem] text-center text-base font-bold"
                          />
                        </TableCell>
                        <TableCell className="text-right">{formatMoney(l.unitPrice)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatMoney(l.quantity * l.unitPrice)}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => setNewLines((ls) => ls.filter((x) => x.productId !== l.productId))}>
                            <Trash2 className="size-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              <p className="mt-1 text-right text-sm font-semibold text-[#22264B]">New items value: {formatMoney(newTotal)}</p>
            </div>

            </div>
            {/* Settlement */}
            <div>
              <h3 className="mb-2 text-sm font-bold tracking-wide text-[#22264B] uppercase">3 · Settlement</h3>
              <div className={`mb-3 flex items-center justify-between rounded-xl px-4 py-3 text-white ${difference > 0 ? "bg-amber-600" : difference < 0 ? "bg-emerald-600" : "bg-[#22264B]"}`}>
                <span className="text-sm font-medium">
                  {difference > 0 ? "Customer tops up" : difference < 0 ? "Credited to deposit wallet" : "Values match — straight swap"}
                </span>
                <span className="text-lg font-black">{formatMoney(Math.abs(difference))}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Settlement method</Label>
                  <Select value={settlement} onValueChange={(v) => setSettlement(v as Settlement)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {difference === 0 && <SelectItem value="NONE">{SETTLEMENT_LABELS.NONE}</SelectItem>}
                      {difference > 0 && (
                        <>
                          <SelectItem value="TOPUP_CASH">{SETTLEMENT_LABELS.TOPUP_CASH}</SelectItem>
                          <SelectItem value="TOPUP_TRANSFER">{SETTLEMENT_LABELS.TOPUP_TRANSFER}</SelectItem>
                          <SelectItem value="TOPUP_POS">{SETTLEMENT_LABELS.TOPUP_POS}</SelectItem>
                          <SelectItem value="TOPUP_CHEQUE">{SETTLEMENT_LABELS.TOPUP_CHEQUE}</SelectItem>
                          {customer && <SelectItem value="TOPUP_DEPOSIT">{SETTLEMENT_LABELS.TOPUP_DEPOSIT} ({formatMoney(customer.depositBalance)})</SelectItem>}
                          {customer && <SelectItem value="TOPUP_CREDIT">{SETTLEMENT_LABELS.TOPUP_CREDIT}</SelectItem>}
                        </>
                      )}
                      {difference < 0 && <SelectItem value="TO_DEPOSIT">{SETTLEMENT_LABELS.TO_DEPOSIT}</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                {needsProof && (
                  <div className="space-y-1.5">
                    <Label>Transfer / cheque reference</Label>
                    <Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="Bank ref / cheque no" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>Reason *</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer prefers 4L keg instead" />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
                </div>
              </div>
              {needsProof && (
                <div className="mt-3">
                  <Label>Payment proof</Label>
                  <ProofUpload value={proof} onChange={setProof} />
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={create.isPending || !pickedSaleId || newLines.length === 0 || Object.values(returnQty).every((v) => !v)}
          >
            {create.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Submit exchange
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ DETAIL DIALOG ------------------------------ */

function ExchangeDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const q = trpc.exchanges.getById.useQuery({ id });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            Exchange {d?.ex.reference}
            {d && <Badge variant="outline" className={STATUS_STYLES[d.ex.status]}>{STATUS_LABELS[d.ex.status]}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {d ? `${d.orderNo} · ${d.customer?.fullName ?? "Walk-in"} · ${formatDateTime(d.ex.createdAt)}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {!d ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-1 text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Returned</h4>
                <ul className="space-y-1 text-sm">
                  {d.returnedItems.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span>{i.productName} × {formatQty(i.quantity)}</span>
                      <span className="font-semibold">{formatMoney(i.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 border-t pt-1 text-right text-sm font-bold">{formatMoney(d.ex.returnedTotal)}</p>
              </div>
              <div>
                <h4 className="mb-1 text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">New items</h4>
                <ul className="space-y-1 text-sm">
                  {d.newItems.map((i) => (
                    <li key={i.id} className="flex justify-between">
                      <span>{i.productName} × {formatQty(i.quantity)}</span>
                      <span className="font-semibold">{formatMoney(i.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-1 border-t pt-1 text-right text-sm font-bold">{formatMoney(d.ex.newTotal)}</p>
              </div>
            </div>
            <div className="space-y-1 rounded-lg bg-[#22264B]/5 p-3 text-sm">
              <p><span className="font-semibold">Settlement:</span> {SETTLEMENT_LABELS[d.ex.settlementType]}{d.ex.settledAmount > 0 ? ` — ${formatMoney(d.ex.settledAmount)}` : ""}</p>
              {d.ex.externalReference && <p><span className="font-semibold">Reference:</span> {d.ex.externalReference}</p>}
              <p><span className="font-semibold">Reason:</span> {d.ex.reason}</p>
              <p><span className="font-semibold">Processed by:</span> {d.processorName}{d.approverName ? ` · Approved by ${d.approverName}` : ""}</p>
              {d.ex.rejectedReason && <p className="text-red-600"><span className="font-semibold">Rejected:</span> {d.ex.rejectedReason}</p>}
              {d.ex.notes && <p className="text-[#22264B]/60">{d.ex.notes}</p>}
            </div>
            {d.ex.proofUrl && (
              <a href={d.ex.proofUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-[#F7A026] underline">
                View payment proof
              </a>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- PAGE --------------------------------- */

export default function Exchanges() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("exchanges.create");
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [createSaleId, setCreateSaleId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  const listQuery = trpc.exchanges.list.useQuery({ status: status === "ALL" ? undefined : (status as never) });

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
      topups: completed.filter((r) => r.difference > 0).reduce((s, r) => s + r.difference, 0),
    };
  }, [listQuery.data]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Sales Exchanges</h2>
          <p className="text-sm text-[#22264B]/55">
            Swap sold items for new ones — top-ups by any payment method, differences credited to the deposit wallet.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => { setCreateSaleId(null); setCreateOpen(true); }}>
            <Plus className="mr-2 size-4" /> New exchange
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Exchanges</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{totals.count}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Awaiting approval</p>
          <p className="mt-1 text-xl font-black text-amber-600">{totals.pending}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Top-ups collected</p>
          <p className="mt-1 text-xl font-black text-emerald-600">{formatMoney(totals.topups)}</p>
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
            <ArrowLeftRight className="size-8 text-[#22264B]/20" />
            <p className="text-sm text-[#22264B]/50">No exchanges yet.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Sale</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">New</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => setDetailId(r.id)}>
                  <TableCell className="font-bold text-[#22264B]">{r.reference}</TableCell>
                  <TableCell>{r.orderNo}</TableCell>
                  <TableCell>{r.customerName ?? "Walk-in"}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.returnedTotal)}</TableCell>
                  <TableCell className="text-right">{formatMoney(r.newTotal)}</TableCell>
                  <TableCell className={`text-right font-semibold ${r.difference > 0 ? "text-amber-600" : r.difference < 0 ? "text-emerald-600" : ""}`}>
                    {r.difference === 0 ? "—" : formatMoney(Math.abs(r.difference))}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={STATUS_STYLES[r.status]}>{STATUS_LABELS[r.status]}</Badge></TableCell>
                  <TableCell className="text-[#22264B]/60">{formatDateTime(r.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <NewExchangeDialog
        open={createOpen}
        saleId={createSaleId}
        onClose={() => setCreateOpen(false)}
        onDone={() => listQuery.refetch()}
      />
      {detailId != null && <ExchangeDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}
