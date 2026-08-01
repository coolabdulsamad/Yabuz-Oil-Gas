import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Check, Pencil, Plus, Rocket, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AlertDialogTrigger,
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
 * YABUZ OIL & GAS — price list detail.
 * Drafts are fully editable (per-item prices, add/remove products);
 * publishing stamps every product with the new prices and locks the
 * batch forever as history. The sheet's "OLD PRICE" column is stamped
 * automatically at publish time.
 */

type Item = {
  id: number;
  productId: number;
  productName: string;
  sku: string;
  packDescription: string;
  unitsPerPack: number;
  unitLabel: string;
  productStatus: string;
  producerCartonPrice: number;
  producerUnitPrice: number;
  marketerCartonPrice: number;
  marketerUnitPrice: number;
  cartonGain: number;
  unitGain: number;
  oldPrice: number | null;
};

export default function PriceListDetail() {
  const { id } = useParams<{ id: string }>();
  const listId = Number(id);
  const { hasPermission } = useAuth();
  const canManage = hasPermission("prices.manage");
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Item | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const query = trpc.priceLists.getById.useQuery({ id: listId });
  const list = query.data;
  const isDraft = list ? !list.isActive && list.approvalStatus !== "APPROVED" : false;
  const editable = canManage && isDraft;

  const refresh = () => {
    utils.priceLists.getById.invalidate({ id: listId });
    utils.priceLists.list.invalidate();
    utils.products.list.invalidate();
  };

  const updateItemMutation = trpc.priceLists.updateItem.useMutation({
    onSuccess: () => {
      toast.success("Prices updated.");
      setEditing(null);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const publishMutation = trpc.priceLists.publish.useMutation({
    onSuccess: (r) => {
      toast.success(`Published — ${r.applied} product price(s) updated across the catalog.`);
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const removeItemMutation = trpc.priceLists.removeItem.useMutation({
    onSuccess: () => {
      toast.success("Item removed from the draft.");
      refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.priceLists.deleteDraft.useMutation({
    onSuccess: () => {
      toast.success("Draft deleted.");
      window.history.back();
    },
    onError: (e) => toast.error(e.message),
  });

  const items = useMemo(() => {
    const all = (list?.items ?? []) as unknown as Item[];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) => i.productName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [list, search]);

  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!list) {
    return (
      <div className="rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 px-6 py-14 text-center text-sm text-[#22264B]/50">
        Price list not found.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            to="/price-lists"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#22264B]/60 hover:text-[#22264B]"
          >
            <ArrowLeft className="h-4 w-4" /> All price lists
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h2 className="text-xl font-black tracking-tight text-[#22264B]">{list.name}</h2>
            {list.isActive ? (
              <Badge className="border-0 bg-[#F7A026] font-semibold text-[#22264B] hover:bg-[#F7A026]">
                Published
              </Badge>
            ) : isDraft ? (
              <Badge variant="outline" className="border-[#F7A026]/50 bg-[#F7A026]/10 text-[#8a5a00]">
                Draft
              </Badge>
            ) : (
              <Badge variant="outline" className="border-[#22264B]/20 text-[#22264B]/60">
                Archived
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-[#22264B]/60">
            {list.isActive && list.effectiveFrom
              ? `Effective since ${formatDateTime(list.effectiveFrom)}`
              : isDraft
                ? "Editing a draft — nothing touches product prices until you publish."
                : `Created ${formatDateTime(list.createdAt)}`}
          </p>
        </div>

        {canManage && isDraft && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="border-[#22264B]/20" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add product
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="border-red-600/30 text-red-600 hover:bg-red-50">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete draft
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
                  <AlertDialogDescription>
                    "{list.name}" and its price entries will be removed. Published lists are never
                    deleted.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteMutation.mutate({ id: listId })}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Delete draft
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#F7A026]/90">
                  <Rocket className="mr-2 h-4 w-4" /> Publish this list
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Publish "{list.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Every product in this list gets its new producer & marketer prices immediately,
                    this batch becomes the single published list, and it locks permanently as the
                    price history. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Not yet</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => publishMutation.mutate({ id: listId })}
                    className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
                  >
                    Publish now
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#22264B]/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product or SKU…"
          className="border-[#22264B]/15 bg-white pl-9"
        />
      </div>

      {/* Items table */}
      <div className="overflow-x-auto rounded-2xl border border-[#22264B]/10 bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#F4EFE3]">
              <TableHead className="text-[#22264B]">Product</TableHead>
              <TableHead className="text-right text-[#22264B]">Producer / pack</TableHead>
              <TableHead className="text-right text-[#22264B]">Marketer / pack</TableHead>
              <TableHead className="text-right text-[#22264B]">Gain / pack</TableHead>
              <TableHead className="text-right text-[#22264B]">Producer / unit</TableHead>
              <TableHead className="text-right text-[#22264B]">Marketer / unit</TableHead>
              <TableHead className="text-right text-[#22264B]">Old price</TableHead>
              {editable && <TableHead className="w-20 text-right text-[#22264B]" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={editable ? 8 : 7} className="py-10 text-center text-sm text-[#22264B]/50">
                  No products in this list.
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <p className="font-medium text-[#22264B]">{item.productName}</p>
                  <p className="text-xs text-[#22264B]/50">
                    {item.sku} · {formatQty(item.unitsPerPack)} {item.unitLabel.toLowerCase()}/pack
                  </p>
                </TableCell>
                <TableCell className="text-right font-medium text-[#22264B]/80">
                  {formatMoney(item.producerCartonPrice)}
                </TableCell>
                <TableCell className="text-right font-bold text-[#22264B]">
                  {formatMoney(item.marketerCartonPrice)}
                </TableCell>
                <TableCell
                  className={`text-right font-semibold ${item.cartonGain >= 0 ? "text-emerald-700" : "text-red-600"}`}
                >
                  {item.cartonGain >= 0 ? "+" : ""}
                  {formatMoney(item.cartonGain)}
                </TableCell>
                <TableCell className="text-right text-[#22264B]/70">
                  {formatMoney(item.producerUnitPrice)}
                </TableCell>
                <TableCell className="text-right text-[#22264B]/70">
                  {formatMoney(item.marketerUnitPrice)}
                </TableCell>
                <TableCell className="text-right text-[#22264B]/50">
                  {item.oldPrice != null ? formatMoney(item.oldPrice) : "—"}
                </TableCell>
                {editable && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(item)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        onClick={() => removeItemMutation.mutate({ itemId: item.id })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit item dialog */}
      <EditItemDialog
        item={editing}
        busy={updateItemMutation.isPending}
        onClose={() => setEditing(null)}
        onSave={(values) => updateItemMutation.mutate({ itemId: editing!.id, ...values })}
      />

      {/* Add product dialog */}
      <AddItemDialog
        open={addOpen}
        listId={listId}
        existingProductIds={(list.items ?? []).map((i) => i.productId)}
        onClose={() => setAddOpen(false)}
        onAdded={refresh}
      />
    </div>
  );
}

/* ------------------------------ edit item ------------------------------ */

function EditItemDialog({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: Item | null;
  busy: boolean;
  onClose: () => void;
  onSave: (v: {
    producerCartonPrice: number;
    producerUnitPrice: number;
    marketerCartonPrice: number;
    marketerUnitPrice: number;
  }) => void;
}) {
  const [pc, setPc] = useState("");
  const [pu, setPu] = useState("");
  const [mc, setMc] = useState("");
  const [mu, setMu] = useState("");
  const [lastId, setLastId] = useState<number | null>(null);

  if ((item?.id ?? null) !== lastId) {
    setLastId(item?.id ?? null);
    if (item) {
      setPc(String(item.producerCartonPrice));
      setPu(String(item.producerUnitPrice));
      setMc(String(item.marketerCartonPrice));
      setMu(String(item.marketerUnitPrice));
    }
  }

  const n = (s: string) => Number(s) || 0;
  const gain = n(mc) - n(pc);

  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">{item?.productName}</DialogTitle>
          <DialogDescription>
            Unit prices auto-fill from the pack price ÷ {item ? formatQty(item.unitsPerPack) : ""} — adjust
            freely if Polar's sheet says otherwise.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <PriceField label="Producer / pack" value={pc} onChange={(v) => { setPc(v); if (item) setPu((n(v) / item.unitsPerPack).toFixed(2)); }} />
          <PriceField label="Producer / unit" value={pu} onChange={setPu} />
          <PriceField label="Marketer / pack" value={mc} onChange={(v) => { setMc(v); if (item) setMu((n(v) / item.unitsPerPack).toFixed(2)); }} />
          <PriceField label="Marketer / unit" value={mu} onChange={setMu} />
        </div>
        <p className="text-sm text-[#22264B]/65">
          Gain per pack:{" "}
          <strong className={gain >= 0 ? "text-emerald-700" : "text-red-600"}>{formatMoney(gain)}</strong>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            <X className="mr-1.5 h-4 w-4" /> Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={() =>
              onSave({
                producerCartonPrice: n(pc),
                producerUnitPrice: n(pu),
                marketerCartonPrice: n(mc),
                marketerUnitPrice: n(mu),
              })
            }
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            <Check className="mr-1.5 h-4 w-4" /> {busy ? "Saving…" : "Save prices"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-[#22264B]">{label}</p>
      <Input type="number" min="0" step="any" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/* ------------------------------ add item ------------------------------ */

function AddItemDialog({
  open,
  listId,
  existingProductIds,
  onClose,
  onAdded,
}: {
  open: boolean;
  listId: number;
  existingProductIds: number[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [productId, setProductId] = useState("");
  const productsQuery = trpc.products.list.useQuery({ status: "ACTIVE" }, { enabled: open });
  const addMutation = trpc.priceLists.addItem.useMutation({
    onSuccess: () => {
      toast.success("Product added with its current prices.");
      setProductId("");
      onClose();
      onAdded();
    },
    onError: (e) => toast.error(e.message),
  });

  const existing = new Set(existingProductIds);
  const candidates = (productsQuery.data ?? []).filter((p) => !existing.has(p.id));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">Add a product to this draft</DialogTitle>
          <DialogDescription>
            It joins with its current catalog prices — edit them afterwards if the new batch
            changes them.
          </DialogDescription>
        </DialogHeader>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger>
            <SelectValue placeholder="Choose a product…" />
          </SelectTrigger>
          <SelectContent>
            {candidates.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
            {candidates.length === 0 && (
              <SelectItem value="__none" disabled>
                Every active product is already listed
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={addMutation.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!productId || addMutation.isPending}
            onClick={() => addMutation.mutate({ priceListId: listId, productId: Number(productId) })}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {addMutation.isPending ? "Adding…" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
