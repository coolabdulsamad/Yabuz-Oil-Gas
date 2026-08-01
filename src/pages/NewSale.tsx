import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Loader2, Pause, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney, formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
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
 * YABUZ OIL & GAS — POS sale builder.
 * /sales/new creates; /sales/:id/edit loads a DRAFT/ON_HOLD sale for editing.
 * Price overrides and discounts are permission-gated; the payment mode
 * decides what happens at final approval (unpaid / credit / deposit wallet).
 */

type PaymentMode = "PAY_LATER" | "CREDIT" | "DEPOSIT";

interface SaleLine {
  productId: number;
  name: string;
  sku: string;
  packDescription: string;
  packType: string;
  allowUnitSales: boolean;
  unitsPerPack: number;
  unitLabel: string;
  currentStock: number;
  soldAsUnits: boolean;
  quantity: string;
  unitPrice: string;
  defaultPrice: number;
  discountAmount: string;
}

const num = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export default function NewSale() {
  const { id } = useParams();
  const editId = id ? Number(id) : null;
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { hasPermission } = useAuth();
  const canOverridePrice = hasPermission("sales.override_price");
  const canDiscount = hasPermission("sales.apply_discount");
  const canCredit = hasPermission("sales.sell_on_credit");
  const canHold = hasPermission("sales.hold");

  const [productSearch, setProductSearch] = useState("");
  const [customerId, setCustomerId] = useState<string>("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("PAY_LATER");
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [saleDiscount, setSaleDiscount] = useState("0");
  const [discountNote, setDiscountNote] = useState("");
  const [notes, setNotes] = useState("");
  const [loadedDraft, setLoadedDraft] = useState<number | null>(null);

  const productsQuery = trpc.products.list.useQuery({ status: "ACTIVE" });
  const customersQuery = trpc.customers.list.useQuery({ status: "ACTIVE" });
  const draftQuery = trpc.sales.getById.useQuery(
    { id: editId! },
    { enabled: editId !== null && loadedDraft !== editId },
  );

  // Load a draft/held sale into the builder once (after products are ready,
  // so unit prices / pack data resolve correctly).
  if (editId !== null && draftQuery.data && productsQuery.data && loadedDraft !== editId) {
    const d = draftQuery.data;
    if (d.sale.status !== "DRAFT" && d.sale.status !== "ON_HOLD") {
      toast.error("Only draft or held sales can be edited.");
      navigate(`/sales/${editId}`, { replace: true });
    } else {
      setLoadedDraft(editId);
      setCustomerId(d.sale.customerId ? String(d.sale.customerId) : "");
      setPaymentMode(d.sale.paymentMode);
      setSaleDiscount(String(d.sale.discountTotal - d.items.reduce((s, i) => s + i.discountAmount, 0)));
      setDiscountNote(d.sale.discountNote ?? "");
      setNotes(d.sale.notes?.replace(/\[mode:[A-Z_]+\]\s?/, "") ?? "");
      setLines(
        d.items.map((i) => {
          const product = productsQuery.data?.find((p) => p.id === i.productId);
          return {
            productId: i.productId,
            name: i.productName,
            sku: i.sku,
            packDescription: i.packDescription,
            packType: product?.packType ?? "CARTON",
            allowUnitSales: product?.allowUnitSales ?? true,
            unitsPerPack: product?.unitsPerPack ?? 1,
            unitLabel: product?.unitLabel ?? "UNIT",
            currentStock: product?.currentStock ?? 0,
            soldAsUnits: i.soldAsUnits,
            quantity: String(i.quantity),
            unitPrice: String(i.unitPrice),
            defaultPrice: i.soldAsUnits ? (product?.sellUnitPrice ?? i.unitPrice) : (product?.sellCartonPrice ?? i.unitPrice),
            discountAmount: String(i.discountAmount),
          };
        }),
      );
    }
  }

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    const all = productsQuery.data ?? [];
    if (!q) return all.slice(0, 12);
    return all.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 12);
  }, [productsQuery.data, productSearch]);

  const selectedCustomer = useMemo(
    () => (customersQuery.data ?? []).find((c) => String(c.id) === customerId) ?? null,
    [customersQuery.data, customerId],
  );

  const addLine = (productId: number) => {
    const p = (productsQuery.data ?? []).find((x) => x.id === productId);
    if (!p) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (existing) {
        return prev.map((l) =>
          l.productId === productId ? { ...l, quantity: String(num(l.quantity) + 1) } : l,
        );
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          packDescription: p.packDescription,
          packType: p.packType,
          allowUnitSales: p.allowUnitSales,
          unitsPerPack: p.unitsPerPack,
          unitLabel: p.unitLabel,
          currentStock: p.currentStock,
          soldAsUnits: false,
          quantity: "1",
          unitPrice: String(p.sellCartonPrice),
          defaultPrice: p.sellCartonPrice,
          discountAmount: "0",
        },
      ];
    });
  };

  const patchLine = (productId: number, patch: Partial<SaleLine>) =>
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));

  const toggleSoldAs = (line: SaleLine, soldAsUnits: boolean) => {
    const p = (productsQuery.data ?? []).find((x) => x.id === line.productId);
    const price = soldAsUnits ? (p?.sellUnitPrice ?? 0) : (p?.sellCartonPrice ?? 0);
    patchLine(line.productId, { soldAsUnits, unitPrice: String(price), defaultPrice: price });
  };

  const subtotal = lines.reduce((s, l) => s + Math.max(0, num(l.quantity) * num(l.unitPrice) - num(l.discountAmount)), 0);
  const grandTotal = Math.max(0, subtotal - num(saleDiscount));

  const buildPayload = () => ({
    customerId: customerId ? Number(customerId) : undefined,
    paymentMode,
    items: lines.map((l) => ({
      productId: l.productId,
      soldAsUnits: l.soldAsUnits,
      quantity: num(l.quantity),
      unitPrice: num(l.unitPrice),
      discountAmount: num(l.discountAmount),
    })),
    saleDiscount: num(saleDiscount),
    discountNote: discountNote.trim() || undefined,
    notes: notes.trim() || undefined,
  });

  const validate = (): string | null => {
    if (lines.length === 0) return "Add at least one product to the sale.";
    for (const l of lines) {
      if (num(l.quantity) <= 0) return `Enter a quantity for "${l.name}".`;
    }
    if (paymentMode !== "PAY_LATER" && !customerId) return "Credit and deposit sales need a customer account.";
    if (grandTotal <= 0) return "The sale total must be greater than zero.";
    return null;
  };

  const createMutation = trpc.sales.create.useMutation({
    onSuccess: async (r) => {
      await utils.sales.list.invalidate();
      toast.success(
        r.outcome === "PENDING"
          ? "Sale submitted for approval."
          : r.outcome === "COMPLETED"
            ? "Sale completed."
            : r.outcome === "HELD"
              ? "Sale put on hold."
              : "Draft saved.",
      );
      navigate(`/sales/${r.saleId}`);
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.sales.updateDraft.useMutation({
    onError: (e) => toast.error(e.message),
  });
  const submitMutation = trpc.sales.submit.useMutation({
    onError: (e) => toast.error(e.message),
  });

  const busy = createMutation.isPending || updateMutation.isPending || submitMutation.isPending;

  const save = async (action: "DRAFT" | "SUBMIT" | "HOLD") => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    if (editId === null) {
      createMutation.mutate({ ...buildPayload(), action });
      return;
    }
    // Editing a draft: update first, then optionally submit.
    try {
      await updateMutation.mutateAsync({ ...buildPayload(), saleId: editId });
      if (action === "SUBMIT") {
        const r = await submitMutation.mutateAsync({ saleId: editId });
        await utils.sales.list.invalidate();
        toast.success(r.outcome === "COMPLETED" ? "Sale completed." : "Sale submitted for approval.");
      } else {
        await utils.sales.list.invalidate();
        toast.success("Draft saved.");
      }
      navigate(`/sales/${editId}`);
    } catch {
      /* mutations already toasted the error */
    }
  };

  if (editId !== null && loadedDraft !== editId) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="icon">
          <Link to="/sales">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">
            {editId !== null ? "Edit Sale" : "New Sale"}
          </h2>
          <p className="text-sm text-[#22264B]/55">
            Build the order, choose how the customer settles, then submit for approval.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* ------------------------------ LEFT: lines ------------------------------ */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Search products by name or SKU…"
                className="pl-9"
              />
            </div>
            <div className="mt-3 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
              {productsQuery.isLoading && <Skeleton className="h-20 w-full sm:col-span-2" />}
              {filteredProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addLine(p.id)}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[#22264B]/10 px-3 py-2 text-left transition hover:border-[#F7A026] hover:bg-[#F7A026]/5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#22264B]">{p.name}</span>
                    <span className="block text-xs text-[#22264B]/45">
                      {p.sku} · stock {formatQty(p.currentStock)}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-bold text-[#22264B]">{formatMoney(p.sellCartonPrice)}</span>
                </button>
              ))}
              {!productsQuery.isLoading && filteredProducts.length === 0 && (
                <p className="py-4 text-center text-sm text-[#22264B]/50 sm:col-span-2">No products match.</p>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
            <Table>
              <TableHeader>
                <TableRow className="bg-[#22264B]/[0.03]">
                  <TableHead>Product</TableHead>
                  <TableHead className="w-28">Sold as</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-32">Price</TableHead>
                  {canDiscount && <TableHead className="w-28">Discount</TableHead>}
                  <TableHead className="w-28 text-right">Line total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canDiscount ? 7 : 6} className="py-10 text-center text-sm text-[#22264B]/45">
                      Click a product above to add it to the sale.
                    </TableCell>
                  </TableRow>
                )}
                {lines.map((l) => {
                  const lineTotal = Math.max(0, num(l.quantity) * num(l.unitPrice) - num(l.discountAmount));
                  const overridden = num(l.unitPrice) !== l.defaultPrice;
                  return (
                    <TableRow key={l.productId}>
                      <TableCell>
                        <span className="block text-sm font-semibold text-[#22264B]">{l.name}</span>
                        <span className="block text-xs text-[#22264B]/45">
                          {l.sku} · {l.packDescription} · stock {formatQty(l.currentStock)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {l.allowUnitSales && l.unitsPerPack > 1 ? (
                          <Select value={l.soldAsUnits ? "UNITS" : "PACKS"} onValueChange={(v) => toggleSoldAs(l, v === "UNITS")}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="PACKS">{l.packType === "CARTON" ? "Cartons" : `${l.packType}s`}</SelectItem>
                              <SelectItem value="UNITS">{l.unitLabel}s</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-xs text-[#22264B]/50">{l.packType === "CARTON" ? "Cartons" : l.packType}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.quantity}
                          onChange={(e) => patchLine(l.productId, { quantity: e.target.value })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="any"
                          value={l.unitPrice}
                          disabled={!canOverridePrice}
                          onChange={(e) => patchLine(l.productId, { unitPrice: e.target.value })}
                          className={`h-8 ${overridden ? "border-amber-500 bg-amber-50" : ""}`}
                          title={canOverridePrice ? "Override price" : "Price override not permitted"}
                        />
                      </TableCell>
                      {canDiscount && (
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            step="any"
                            value={l.discountAmount}
                            onChange={(e) => patchLine(l.productId, { discountAmount: e.target.value })}
                            className="h-8"
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-right text-sm font-bold text-[#22264B]">{formatMoney(lineTotal)}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-red-500 hover:bg-red-50"
                          onClick={() => setLines((prev) => prev.filter((x) => x.productId !== l.productId))}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* ----------------------------- RIGHT: checkout ---------------------------- */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
            <Label className="text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Customer</Label>
            <Select value={customerId || "WALKIN"} onValueChange={(v) => setCustomerId(v === "WALKIN" ? "" : v)}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Walk-in customer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="WALKIN">Walk-in (no account)</SelectItem>
                {(customersQuery.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.fullName} · {c.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label className="mt-4 block text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Settlement</Label>
            <div className="mt-1.5 space-y-2">
              {(
                [
                  { mode: "PAY_LATER" as const, label: "Pay later", hint: "Complete now, collect payment afterwards", disabled: false },
                  { mode: "CREDIT" as const, label: "On credit", hint: "Adds to what the customer owes", disabled: !canCredit },
                  { mode: "DEPOSIT" as const, label: "Deposit wallet", hint: "Draws from money held with us", disabled: false },
                ]
              ).map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  disabled={opt.disabled}
                  onClick={() => setPaymentMode(opt.mode)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    paymentMode === opt.mode
                      ? "border-[#F7A026] bg-[#F7A026]/10"
                      : "border-[#22264B]/10 hover:border-[#F7A026]/50"
                  } ${opt.disabled ? "cursor-not-allowed opacity-40" : ""}`}
                  title={opt.disabled ? "You don't have permission to sell on credit" : undefined}
                >
                  <span className="block text-sm font-bold text-[#22264B]">{opt.label}</span>
                  <span className="block text-xs text-[#22264B]/50">{opt.hint}</span>
                </button>
              ))}
            </div>

            {selectedCustomer && paymentMode === "CREDIT" && (
              <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {selectedCustomer.creditLimit > 0
                  ? `Credit available: ${formatMoney(selectedCustomer.creditLimit - selectedCustomer.creditOutstanding)} of ${formatMoney(selectedCustomer.creditLimit)} limit.`
                  : "This customer has no credit allowance."}
              </p>
            )}
            {selectedCustomer && paymentMode === "DEPOSIT" && (
              <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                Deposit balance: {formatMoney(selectedCustomer.depositBalance)}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#22264B]/60">Subtotal</span>
              <span className="font-bold text-[#22264B]">{formatMoney(subtotal)}</span>
            </div>
            {canDiscount && (
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span className="text-[#22264B]/60">Sale discount</span>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={saleDiscount}
                  onChange={(e) => setSaleDiscount(e.target.value)}
                  className="h-8 w-32 text-right"
                />
              </div>
            )}
            {canDiscount && num(saleDiscount) > 0 && (
              <Input
                value={discountNote}
                onChange={(e) => setDiscountNote(e.target.value)}
                placeholder="Discount reason…"
                className="mt-2 h-8 text-xs"
              />
            )}
            <div className="mt-3 flex items-center justify-between border-t border-[#22264B]/10 pt-3">
              <span className="text-sm font-bold text-[#22264B]">Grand total</span>
              <span className="text-lg font-black text-[#F7A026]">{formatMoney(grandTotal)}</span>
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sale notes (optional)…"
              className="mt-3 min-h-16 text-sm"
            />

            <div className="mt-4 space-y-2">
              <Button
                className="w-full bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]"
                disabled={busy}
                onClick={() => save("SUBMIT")}
              >
                {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Send className="mr-2 size-4" />}
                Submit sale
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => save("DRAFT")}>
                  Save draft
                </Button>
                {canHold && editId === null && (
                  <Button variant="outline" className="flex-1" disabled={busy} onClick={() => save("HOLD")}>
                    <Pause className="mr-1 size-4" /> Hold
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
