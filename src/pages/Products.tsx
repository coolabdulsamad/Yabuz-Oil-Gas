import { useMemo, useState } from "react";
import { Link } from "react-router";
import { FolderCog, Package, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney, formatQty } from "@/lib/format";
import { ProductFormDialog, type EditableProduct } from "@/components/products/ProductFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — product catalog.
 * Card grid with category/status filters; cost prices and margins only
 * appear for staff holding prices.view_cost (stripped server-side too).
 */

type ProductRow = EditableProduct & {
  sku: string;
  status: "ACTIVE" | "INACTIVE" | "DISCONTINUED";
  currentStock: number;
  primaryImageUrl: string | null;
  categoryName: string;
  categoryCode: string;
};

const STATUS_STYLES = {
  ACTIVE: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/60",
  DISCONTINUED: "border-red-600/30 bg-red-50 text-red-700",
} as const;

export default function Products() {
  const { hasPermission } = useAuth();
  const canViewCost = hasPermission("prices.view_cost");
  const canCreate = hasPermission("products.create");
  const canManageCategories = hasPermission("products.manage_categories");

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("all");
  const [status, setStatus] = useState<string>("ACTIVE");
  const [editor, setEditor] = useState<EditableProduct | null | undefined>(undefined);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  const utils = trpc.useUtils();
  const categoriesQuery = trpc.products.listCategories.useQuery();
  const listQuery = trpc.products.list.useQuery({
    search: search || undefined,
    categoryId: categoryId === "all" ? undefined : Number(categoryId),
    status: status === "all" ? undefined : (status as "ACTIVE" | "INACTIVE" | "DISCONTINUED"),
  });

  const rows = (listQuery.data ?? []) as unknown as ProductRow[];
  const categories = categoriesQuery.data ?? [];

  const stats = useMemo(() => {
    const all = rows;
    return {
      count: all.length,
      lowStock: all.filter((p) => p.currentStock <= p.reorderLevel).length,
      sellValue: canViewCost
        ? all.reduce((s, p) => s + p.currentStock * (p.sellCartonPrice ?? 0), 0)
        : null,
    };
  }, [rows, canViewCost]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Products</h2>
          <p className="mt-0.5 text-sm text-[#22264B]/60">
            {stats.count} product{stats.count === 1 ? "" : "s"}
            {stats.lowStock > 0 && ` · ${stats.lowStock} low on stock`}
            {stats.sellValue !== null && ` · ${formatMoney(stats.sellValue)} at selling price`}
          </p>
        </div>
        <div className="flex gap-2">
          {canManageCategories && (
            <Button variant="outline" onClick={() => setCategoriesOpen(true)} className="border-[#22264B]/20">
              <FolderCog className="mr-2 h-4 w-4" /> Categories
            </Button>
          )}
          {canCreate && (
            <Button onClick={() => setEditor(null)} className="bg-[#22264B] text-white hover:bg-[#22264B]/90">
              <Plus className="mr-2 h-4 w-4" /> Add product
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, SKU or barcode…"
            className="border-[#22264B]/15 bg-white pl-9"
          />
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="w-56 bg-white">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.code} — {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40 bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="DISCONTINUED">Discontinued</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {listQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 px-6 py-14 text-center">
          <Package className="mx-auto h-8 w-8 text-[#22264B]/25" />
          <p className="mt-3 text-sm text-[#22264B]/50">No products match these filters.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => {
            const margin =
              canViewCost && p.sellCartonPrice != null && p.costCartonPrice != null
                ? p.sellCartonPrice - p.costCartonPrice
                : null;
            const low = p.currentStock <= p.reorderLevel;
            return (
              <Link
                key={p.id}
                to={`/products/${p.id}`}
                className="group flex flex-col rounded-2xl border border-[#22264B]/10 bg-white p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <Badge variant="outline" className="border-[#22264B]/15 font-mono text-[10px] text-[#22264B]/60">
                    {p.sku}
                  </Badge>
                  <Badge variant="outline" className={`${STATUS_STYLES[p.status]} text-[10px]`}>
                    {p.status === "DISCONTINUED" ? "Discontinued" : p.status === "INACTIVE" ? "Inactive" : "Active"}
                  </Badge>
                </div>

                <h3 className="mt-3 line-clamp-2 font-bold leading-snug text-[#22264B] group-hover:text-[#22264B]">
                  {p.name}
                </h3>
                <p className="mt-1 text-xs text-[#22264B]/55">
                  {p.categoryName} · {formatQty(p.unitsPerPack)} {p.unitLabel.toLowerCase()}/
                  {p.packType.toLowerCase()}
                </p>

                <div className="mt-4 flex items-end justify-between border-t border-[#22264B]/8 pt-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-[#22264B]/45">Selling / pack</p>
                    <p className="font-black text-[#22264B]">
                      {p.sellCartonPrice != null ? formatMoney(p.sellCartonPrice) : "—"}
                    </p>
                    {margin !== null && (
                      <p className={`text-[11px] font-medium ${margin >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                        +{formatMoney(margin)} margin
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wide text-[#22264B]/45">In stock</p>
                    <p className={`font-black ${low ? "text-[#F7A026]" : "text-[#22264B]"}`}>
                      {formatQty(p.currentStock)}
                      <span className="ml-1 text-[11px] font-medium text-[#22264B]/50">
                        {p.packType.toLowerCase()}
                        {p.currentStock === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <ProductFormDialog
        product={editor}
        canEditPrices={hasPermission("prices.manage")}
        onClose={() => setEditor(undefined)}
        onSaved={() => utils.products.list.invalidate()}
      />

      <CategoriesDialog
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        onChanged={() => {
          utils.products.listCategories.invalidate();
          utils.products.list.invalidate();
        }}
      />
    </div>
  );
}

/* ------------------------- Categories manager ------------------------- */

type CategoryRow = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount: number;
};

function CategoriesDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const query = trpc.products.listCategories.useQuery(undefined, { enabled: open });
  const [editing, setEditing] = useState<CategoryRow | null>(null);

  const createMutation = trpc.products.createCategory.useMutation({
    onSuccess: () => {
      toast.success("Category created.");
      setEditing(null);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.products.updateCategory.useMutation({
    onSuccess: () => {
      toast.success("Category updated.");
      setEditing(null);
      onChanged();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">Product categories</DialogTitle>
          <DialogDescription>
            Categories group products on the price list (the A–I codes from Polar).
          </DialogDescription>
        </DialogHeader>

        {editing === null ? (
          <>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() =>
                  setEditing({ id: 0, code: "", name: "", description: "", sortOrder: 0, isActive: true, productCount: 0 })
                }
                className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
              >
                <Plus className="mr-1.5 h-4 w-4" /> New category
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow className="bg-[#F4EFE3]">
                  <TableHead className="w-16 text-[#22264B]">Code</TableHead>
                  <TableHead className="text-[#22264B]">Name</TableHead>
                  <TableHead className="w-24 text-center text-[#22264B]">Products</TableHead>
                  <TableHead className="w-24 text-center text-[#22264B]">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(query.data ?? []).map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer"
                    onClick={() => setEditing(c as CategoryRow)}
                  >
                    <TableCell className="font-mono font-bold text-[#22264B]">{c.code}</TableCell>
                    <TableCell className="font-medium text-[#22264B]">{c.name}</TableCell>
                    <TableCell className="text-center text-[#22264B]/70">{c.productCount}</TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          c.isActive
                            ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
                            : "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50"
                        }
                      >
                        {c.isActive ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : (
          <CategoryEditor
            category={editing}
            busy={createMutation.isPending || updateMutation.isPending}
            onCancel={() => setEditing(null)}
            onSave={(values) => {
              if (editing.id === 0) {
                createMutation.mutate({
                  code: values.code,
                  name: values.name,
                  description: values.description,
                  sortOrder: values.sortOrder,
                });
              } else {
                updateMutation.mutate({ id: editing.id, ...values });
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryEditor({
  category,
  busy,
  onCancel,
  onSave,
}: {
  category: CategoryRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (v: { code: string; name: string; description: string; sortOrder: number; isActive: boolean }) => void;
}) {
  const [code, setCode] = useState(category.code);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? "");
  const [sortOrder, setSortOrder] = useState(String(category.sortOrder));
  const [isActive, setIsActive] = useState(category.isActive);

  const valid = code.trim().length > 0 && name.trim().length >= 2;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="cat-code">Code</Label>
          <Input
            id="cat-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. J"
            maxLength={10}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="cat-name">Name</Label>
          <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. POLAR BRAKE FLUID" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cat-desc">Description</Label>
        <Textarea id="cat-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="w-32 space-y-1.5">
          <Label htmlFor="cat-sort">Sort order</Label>
          <Input id="cat-sort" type="number" min="0" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={isActive} onCheckedChange={setIsActive} className="data-[state=checked]:bg-[#F7A026]" />
          <Label>Active</Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Back
        </Button>
        <Button
          disabled={!valid || busy}
          onClick={() =>
            onSave({
              code: code.trim(),
              name: name.trim(),
              description,
              sortOrder: Number(sortOrder) || 0,
              isActive,
            })
          }
          className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
        >
          {busy ? "Saving…" : category.id === 0 ? "Create category" : "Save changes"}
        </Button>
      </DialogFooter>
    </div>
  );
}
