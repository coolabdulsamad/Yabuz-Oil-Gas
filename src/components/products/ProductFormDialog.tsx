import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { PACK_TYPES } from "@contracts/constants";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Separator } from "@/components/ui/separator";

/**
 * YABUZ OIL & GAS — product create/edit form.
 * Detailed: pack configuration, dual pricing (producer cost / marketer
 * sell), unit-sales toggle, reorder level, storage location.
 * Price fields are locked unless the user holds prices.manage.
 */

export interface ProductFormValues {
  name: string;
  description: string;
  categoryId: number | null;
  packType: (typeof PACK_TYPES)[number];
  packDescription: string;
  unitsPerPack: string;
  unitLabel: string;
  volumePerUnit: string;
  costCartonPrice: string;
  costUnitPrice: string;
  sellCartonPrice: string;
  sellUnitPrice: string;
  allowUnitSales: boolean;
  reorderLevel: string;
  storeLocation: string;
  barcode: string;
}

export type EditableProduct = {
  id: number;
  name: string;
  description: string | null;
  categoryId: number;
  packType: (typeof PACK_TYPES)[number];
  packDescription: string;
  unitsPerPack: number;
  unitLabel: string;
  volumePerUnit: number | null;
  costCartonPrice: number | null;
  costUnitPrice: number | null;
  sellCartonPrice: number | null;
  sellUnitPrice: number | null;
  allowUnitSales: boolean;
  reorderLevel: number;
  storeLocation: string | null;
  barcode: string | null;
};

const EMPTY: ProductFormValues = {
  name: "",
  description: "",
  categoryId: null,
  packType: "CARTON",
  packDescription: "",
  unitsPerPack: "12",
  unitLabel: "GALLON",
  volumePerUnit: "",
  costCartonPrice: "",
  costUnitPrice: "",
  sellCartonPrice: "",
  sellUnitPrice: "",
  allowUnitSales: true,
  reorderLevel: "0",
  storeLocation: "",
  barcode: "",
};

function toForm(p: EditableProduct): ProductFormValues {
  return {
    name: p.name,
    description: p.description ?? "",
    categoryId: p.categoryId,
    packType: p.packType,
    packDescription: p.packDescription,
    unitsPerPack: String(p.unitsPerPack),
    unitLabel: p.unitLabel,
    volumePerUnit: p.volumePerUnit != null ? String(p.volumePerUnit) : "",
    costCartonPrice: p.costCartonPrice != null ? String(p.costCartonPrice) : "",
    costUnitPrice: p.costUnitPrice != null ? String(p.costUnitPrice) : "",
    sellCartonPrice: p.sellCartonPrice != null ? String(p.sellCartonPrice) : "",
    sellUnitPrice: p.sellUnitPrice != null ? String(p.sellUnitPrice) : "",
    allowUnitSales: p.allowUnitSales,
    reorderLevel: String(p.reorderLevel),
    storeLocation: p.storeLocation ?? "",
    barcode: p.barcode ?? "",
  };
}

const num = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function ProductFormDialog({
  product,
  canEditPrices,
  onClose,
  onSaved,
}: {
  /** undefined → closed, null → create mode, object → edit mode. */
  product: EditableProduct | null | undefined;
  canEditPrices: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = product !== undefined;
  const isEdit = !!product;

  const [form, setForm] = useState<ProductFormValues>(EMPTY);
  const [lastKey, setLastKey] = useState<string>("");
  const key = product ? `edit:${product.id}` : "create";
  if (open && key !== lastKey) {
    setLastKey(key);
    setForm(product ? toForm(product) : EMPTY);
  }

  const set = <K extends keyof ProductFormValues>(k: K, v: ProductFormValues[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const categoriesQuery = trpc.products.listCategories.useQuery(undefined, { enabled: open });
  const categories = (categoriesQuery.data ?? []).filter((c) => c.isActive);

  const createMutation = trpc.products.create.useMutation({
    onSuccess: (r) => {
      toast.success(`Product created — ${r.sku}`);
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: () => {
      toast.success("Product updated.");
      onSaved();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const busy = createMutation.isPending || updateMutation.isPending;

  // Auto-derive unit prices from pack price ÷ units per pack.
  const deriveUnits = (packPrice: string, units: string) => {
    const c = Number(packPrice);
    const u = Number(units);
    return c > 0 && u > 0 ? (c / u).toFixed(2) : "";
  };

  const valid =
    form.name.trim().length >= 3 &&
    form.categoryId !== null &&
    form.packDescription.trim().length > 0 &&
    num(form.unitsPerPack) > 0 &&
    form.unitLabel.trim().length > 0 &&
    (canEditPrices ? form.sellCartonPrice !== "" : true);

  const submit = () => {
    const payload = {
      name: form.name.trim(),
      description: form.description,
      categoryId: form.categoryId!,
      packType: form.packType,
      packDescription: form.packDescription.trim(),
      unitsPerPack: num(form.unitsPerPack),
      unitLabel: form.unitLabel.trim(),
      volumePerUnit: form.volumePerUnit === "" ? null : num(form.volumePerUnit),
      costCartonPrice: num(form.costCartonPrice),
      costUnitPrice: num(form.costUnitPrice),
      sellCartonPrice: num(form.sellCartonPrice),
      sellUnitPrice: num(form.sellUnitPrice),
      allowUnitSales: form.allowUnitSales,
      reorderLevel: num(form.reorderLevel),
      storeLocation: form.storeLocation,
      barcode: form.barcode,
    };
    if (isEdit && product) updateMutation.mutate({ ...payload, id: product.id });
    else createMutation.mutate(payload);
  };

  const margin = num(form.sellCartonPrice) - num(form.costCartonPrice);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">
            {isEdit ? `Edit ${product?.name}` : "Add a new product"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Stock balances never change here — they move through inventory records."
              : "The SKU is generated automatically from the category."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Identity */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pd-name">Product name</Label>
              <Input
                id="pd-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. ALVA 5000 XP 1LTS (12 GALLONS)"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select
                value={form.categoryId !== null ? String(form.categoryId) : ""}
                onValueChange={(v) => set("categoryId", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pd-barcode">
                Barcode <span className="text-[#22264B]/40">(optional)</span>
              </Label>
              <Input
                id="pd-barcode"
                value={form.barcode}
                onChange={(e) => set("barcode", e.target.value)}
                placeholder="Scan or type"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pd-desc">
                Description <span className="text-[#22264B]/40">(optional)</span>
              </Label>
              <Textarea
                id="pd-desc"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={2}
                placeholder="Any extra detail staff should know"
              />
            </div>
          </div>

          <Separator />

          {/* Pack configuration */}
          <div>
            <h4 className="mb-3 text-sm font-bold uppercase tracking-[0.08em] text-[#22264B]/70">
              Pack configuration
            </h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Pack type</Label>
                <Select
                  value={form.packType}
                  onValueChange={(v) => set("packType", v as ProductFormValues["packType"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PACK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-packdesc">Pack description</Label>
                <Input
                  id="pd-packdesc"
                  value={form.packDescription}
                  onChange={(e) => set("packDescription", e.target.value)}
                  placeholder="e.g. 1LTS (12 GALLONS)"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-units">Units per pack</Label>
                <Input
                  id="pd-units"
                  type="number"
                  min="0"
                  step="any"
                  value={form.unitsPerPack}
                  onChange={(e) => {
                    set("unitsPerPack", e.target.value);
                    if (form.costCartonPrice) set("costUnitPrice", deriveUnits(form.costCartonPrice, e.target.value));
                    if (form.sellCartonPrice) set("sellUnitPrice", deriveUnits(form.sellCartonPrice, e.target.value));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-unitlabel">Unit label</Label>
                <Input
                  id="pd-unitlabel"
                  value={form.unitLabel}
                  onChange={(e) => set("unitLabel", e.target.value)}
                  placeholder="GALLON / KEG / CUP…"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-vol">
                  Volume per unit <span className="text-[#22264B]/40">(L/Kg)</span>
                </Label>
                <Input
                  id="pd-vol"
                  type="number"
                  min="0"
                  step="any"
                  value={form.volumePerUnit}
                  onChange={(e) => set("volumePerUnit", e.target.value)}
                  placeholder="e.g. 1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-loc">Store location</Label>
                <Input
                  id="pd-loc"
                  value={form.storeLocation}
                  onChange={(e) => set("storeLocation", e.target.value)}
                  placeholder="e.g. Main store A2"
                />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl bg-[#F4EFE3] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#22264B]">Sell by inner unit</p>
                <p className="text-xs text-[#22264B]/55">
                  Allow selling single {(form.unitLabel || "unit").toLowerCase()}s out of a{" "}
                  {form.packType.toLowerCase()}
                </p>
              </div>
              <Switch
                checked={form.allowUnitSales}
                onCheckedChange={(v) => set("allowUnitSales", v)}
                className="data-[state=checked]:bg-[#F7A026]"
              />
            </div>
          </div>

          <Separator />

          {/* Pricing */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-bold uppercase tracking-[0.08em] text-[#22264B]/70">
                Pricing (₦)
              </h4>
              {!canEditPrices && (
                <p className="text-xs text-[#8a5a00]">Price edits need the price-list permission</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pd-cost">Producer pack price (cost)</Label>
                <Input
                  id="pd-cost"
                  type="number"
                  min="0"
                  step="any"
                  disabled={!canEditPrices}
                  value={form.costCartonPrice}
                  onChange={(e) => {
                    set("costCartonPrice", e.target.value);
                    set("costUnitPrice", deriveUnits(e.target.value, form.unitsPerPack));
                  }}
                  placeholder="e.g. 41200"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-costu">Producer unit price</Label>
                <Input
                  id="pd-costu"
                  type="number"
                  min="0"
                  step="any"
                  disabled={!canEditPrices}
                  value={form.costUnitPrice}
                  onChange={(e) => set("costUnitPrice", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-sell">Marketer pack price (sell)</Label>
                <Input
                  id="pd-sell"
                  type="number"
                  min="0"
                  step="any"
                  disabled={!canEditPrices}
                  value={form.sellCartonPrice}
                  onChange={(e) => {
                    set("sellCartonPrice", e.target.value);
                    set("sellUnitPrice", deriveUnits(e.target.value, form.unitsPerPack));
                  }}
                  placeholder="e.g. 45000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pd-sellu">Marketer unit price</Label>
                <Input
                  id="pd-sellu"
                  type="number"
                  min="0"
                  step="any"
                  disabled={!canEditPrices}
                  value={form.sellUnitPrice}
                  onChange={(e) => set("sellUnitPrice", e.target.value)}
                />
              </div>
            </div>
            {canEditPrices && form.sellCartonPrice !== "" && (
              <p className="mt-2 text-xs text-[#22264B]/60">
                Margin per pack:{" "}
                <strong className={margin >= 0 ? "text-emerald-700" : "text-red-600"}>
                  {formatMoney(margin)}
                </strong>{" "}
                ({num(form.sellCartonPrice) > 0 ? ((margin / num(form.sellCartonPrice)) * 100).toFixed(1) : "0"}%)
              </p>
            )}
          </div>

          <Separator />

          {/* Stock control */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pd-reorder">Low-stock alert level (packs)</Label>
              <Input
                id="pd-reorder"
                type="number"
                min="0"
                step="any"
                value={form.reorderLevel}
                onChange={(e) => set("reorderLevel", e.target.value)}
              />
              <p className="text-xs text-[#22264B]/50">
                The dashboard flags this product when stock falls to this level.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || busy}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
