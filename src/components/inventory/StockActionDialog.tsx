import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/**
 * YABUZ OIL & GAS — stock action dialog.
 * One dialog, three modes:
 *   SUPPLY → stock-in from Polar (SUPPLY_IN)
 *   OUT    → damage / manual stock-out
 *   ADJUST → balance correction (+ / −)
 * Every action writes a stock_movements ledger row.
 */

export type StockActionMode = "SUPPLY" | "OUT" | "ADJUST";

const MODE_TEXT: Record<StockActionMode, { title: string; cta: string; hint: string }> = {
  SUPPLY: {
    title: "Record Supply",
    cta: "Add to stock",
    hint: "Stock received into the store (e.g. supply from Polar Petrochemicals).",
  },
  OUT: {
    title: "Record Stock-Out",
    cta: "Remove from stock",
    hint: "Stock leaving without a sale — damage, leakage, write-off.",
  },
  ADJUST: {
    title: "Stock Adjustment",
    cta: "Apply adjustment",
    hint: "Correct a wrong balance. Every adjustment is audit-logged.",
  },
};

interface Props {
  mode: StockActionMode | null; // null = closed
  preselectedProductId?: number;
  onClose: () => void;
}

export function StockActionDialog({ mode, preselectedProductId, onClose }: Props) {
  const open = mode !== null;
  const [formKey, setFormKey] = useState<string>("closed");
  const [productId, setProductId] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [direction, setDirection] = useState<"IN" | "OUT">("IN");
  const [kind, setKind] = useState<"DAMAGE_OUT" | "ADJUSTMENT_OUT">("DAMAGE_OUT");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");

  // Reset the form whenever a fresh dialog session opens.
  const sessionKey = open ? `${mode}-${preselectedProductId ?? "none"}` : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setProductId(preselectedProductId ? String(preselectedProductId) : "");
    setQuantity("");
    setDirection("IN");
    setKind("DAMAGE_OUT");
    setReason("");
    setNotes("");
  }

  const utils = trpc.useUtils();
  const productsQuery = trpc.products.list.useQuery({ status: "ACTIVE" }, { enabled: open });
  const productList = productsQuery.data ?? [];
  const selected = productList.find((p) => String(p.id) === productId);

  const invalidate = () => {
    utils.inventory.overview.invalidate();
    utils.inventory.lowStock.invalidate();
    utils.inventory.movements.invalidate();
    utils.products.list.invalidate();
  };

  const supply = trpc.inventory.recordSupply.useMutation({
    onSuccess: (r) => {
      toast.success(`Supply recorded — new balance ${formatQty(r.balanceAfter)} pack(s).`);
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const stockOut = trpc.inventory.recordStockOut.useMutation({
    onSuccess: (r) => {
      toast.success(`Stock-out recorded — new balance ${formatQty(r.balanceAfter)} pack(s).`);
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const adjust = trpc.inventory.adjust.useMutation({
    onSuccess: (r) => {
      toast.success(`Adjustment applied — new balance ${formatQty(r.balanceAfter)} pack(s).`);
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const pending = supply.isPending || stockOut.isPending || adjust.isPending;
  const qty = Number(quantity);
  const valid =
    productId !== "" &&
    Number.isFinite(qty) &&
    qty > 0 &&
    (mode === "SUPPLY" || reason.trim().length >= 3);

  const submit = () => {
    if (!valid || !mode) return;
    const base = { productId: Number(productId), quantity: qty };
    if (mode === "SUPPLY") {
      supply.mutate({ ...base, reason: reason.trim(), notes: notes.trim() });
    } else if (mode === "OUT") {
      stockOut.mutate({ ...base, kind, reason: reason.trim(), notes: notes.trim() });
    } else {
      adjust.mutate({ ...base, direction, reason: reason.trim(), notes: notes.trim() });
    }
  };

  const text = mode ? MODE_TEXT[mode] : MODE_TEXT.SUPPLY;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">{text.title}</DialogTitle>
          <DialogDescription>{text.hint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder={productsQuery.isLoading ? "Loading products…" : "Choose a product"} />
              </SelectTrigger>
              <SelectContent>
                {productList.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} — {formatQty(p.currentStock)} in stock
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-xs text-[#22264B]/50">
                SKU {selected.sku} · current balance {formatQty(selected.currentStock)} pack(s)
              </p>
            )}
          </div>

          {mode === "OUT" && (
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DAMAGE_OUT">Damage / leakage write-off</SelectItem>
                  <SelectItem value="ADJUSTMENT_OUT">Manual stock-out</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === "ADJUST" && (
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "IN" | "OUT")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Increase stock (+)</SelectItem>
                  <SelectItem value="OUT">Decrease stock (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Quantity (packs)</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 10"
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Reason {mode === "SUPPLY" ? <span className="text-[#22264B]/40">(optional)</span> : null}
            </Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "SUPPLY"
                  ? "e.g. Supply from Polar"
                  : mode === "OUT"
                    ? "e.g. 2 cartons leaked in transit"
                    : "e.g. Found extra cartons in store"
              }
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Notes <span className="text-[#22264B]/40">(optional)</span>
            </Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || pending}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {pending ? "Saving…" : text.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
