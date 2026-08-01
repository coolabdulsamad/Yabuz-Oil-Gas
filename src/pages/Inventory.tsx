import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  ArrowUpCircle,
  ClipboardList,
  PackageMinus,
  PackagePlus,
  Search,
  SlidersHorizontal,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { StockActionDialog, type StockActionMode } from "@/components/inventory/StockActionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { STOCK_MOVEMENT_TYPES } from "@contracts/constants";

/**
 * YABUZ OIL & GAS — inventory module.
 * Tabs: Overview (valuation & positions), Movements (immutable ledger),
 * Stock Counts (physical taking) and Low Stock (reorder watchlist).
 * All stock writes go through the ledger — never direct balance edits.
 */

const MOVEMENT_STYLES: Record<string, string> = {
  SUPPLY_IN: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  PURCHASE_IN: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  RETURN_IN: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  ADJUSTMENT_IN: "border-sky-600/30 bg-sky-50 text-sky-700",
  SALE_OUT: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/70",
  ADJUSTMENT_OUT: "border-amber-600/30 bg-amber-50 text-amber-700",
  COUNT_ADJUST: "border-violet-600/30 bg-violet-50 text-violet-700",
  DAMAGE_OUT: "border-red-600/30 bg-red-50 text-red-700",
};

const MOVEMENT_LABELS: Record<string, string> = {
  SUPPLY_IN: "Supply In",
  PURCHASE_IN: "Purchase In",
  SALE_OUT: "Sale Out",
  RETURN_IN: "Return In",
  ADJUSTMENT_IN: "Adjustment +",
  ADJUSTMENT_OUT: "Adjustment −",
  COUNT_ADJUST: "Count Adjust",
  DAMAGE_OUT: "Damage Out",
};

const COUNT_STATUS_STYLES: Record<string, string> = {
  IN_PROGRESS: "border-amber-600/30 bg-amber-50 text-amber-700",
  COMPLETED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
};

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">{label}</p>
      <p className={`mt-1 text-xl font-black ${accent ? "text-[#F7A026]" : "text-[#22264B]"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[#22264B]/50">{sub}</p>}
    </div>
  );
}

export default function Inventory() {
  const { hasPermission } = useAuth();
  const canStockIn = hasPermission("inventory.stock_in");
  const canStockOut = hasPermission("inventory.stock_out");
  const canAdjust = hasPermission("inventory.adjust");
  const canCount = hasPermission("inventory.stock_count");

  const [action, setAction] = useState<{ mode: StockActionMode; productId?: number } | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Inventory</h2>
          <p className="text-sm text-[#22264B]/55">
            Stock positions, movement ledger, counts and reorder alerts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canStockIn && (
            <Button
              onClick={() => setAction({ mode: "SUPPLY" })}
              className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
            >
              <PackagePlus className="size-4" /> Record Supply
            </Button>
          )}
          {canStockOut && (
            <Button variant="outline" onClick={() => setAction({ mode: "OUT" })}>
              <PackageMinus className="size-4" /> Stock-Out
            </Button>
          )}
          {canAdjust && (
            <Button variant="outline" onClick={() => setAction({ mode: "ADJUST" })}>
              <SlidersHorizontal className="size-4" /> Adjustment
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="bg-[#22264B]/5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="movements">Movements</TabsTrigger>
          <TabsTrigger value="counts">Stock Counts</TabsTrigger>
          <TabsTrigger value="low">Low Stock</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="movements" className="mt-4">
          <MovementsTab />
        </TabsContent>
        <TabsContent value="counts" className="mt-4">
          <CountsTab canCount={canCount} />
        </TabsContent>
        <TabsContent value="low" className="mt-4">
          <LowStockTab canStockIn={canStockIn} onSupply={(id) => setAction({ mode: "SUPPLY", productId: id })} />
        </TabsContent>
      </Tabs>

      <StockActionDialog
        mode={action?.mode ?? null}
        preselectedProductId={action?.productId}
        onClose={() => setAction(null)}
      />
    </div>
  );
}

/* ------------------------------- OVERVIEW ------------------------------- */

function OverviewTab() {
  const { hasPermission } = useAuth();
  const canViewCost = hasPermission("prices.view_cost");
  const [search, setSearch] = useState("");
  const overviewQuery = trpc.inventory.overview.useQuery();

  const data = overviewQuery.data;
  const items = useMemo(() => {
    const all = data?.items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q),
    );
  }, [data, search]);

  if (overviewQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Products" value={String(stats?.totalProducts ?? 0)} sub={`${stats?.inStock ?? 0} in stock`} />
        <StatCard label="Low stock" value={String(stats?.lowStock ?? 0)} accent={(stats?.lowStock ?? 0) > 0} />
        <StatCard label="Out of stock" value={String(stats?.outOfStock ?? 0)} accent={(stats?.outOfStock ?? 0) > 0} />
        <StatCard label="Value (selling)" value={formatMoney(stats?.totalValueSell ?? 0)} />
        {canViewCost && (
          <StatCard label="Value (cost)" value={formatMoney(stats?.totalValueCost ?? 0)} />
        )}
        {canViewCost && (
          <StatCard
            label="Potential margin"
            value={formatMoney((stats?.totalValueSell ?? 0) - (stats?.totalValueCost ?? 0))}
            accent
          />
        )}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product or SKU…"
          className="pl-9"
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">In Stock (packs)</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Value (sell)</TableHead>
              {canViewCost && <TableHead className="text-right">Value (cost)</TableHead>}
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-[#22264B]/50">
                  No products found.
                </TableCell>
              </TableRow>
            )}
            {items.map((i) => (
              <TableRow key={i.id}>
                <TableCell>
                  <Link to={`/products/${i.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {i.name}
                  </Link>
                  <span className="block text-xs text-[#22264B]/45">{i.sku} · {i.packDescription}</span>
                </TableCell>
                <TableCell className="text-sm">{i.categoryName ?? "—"}</TableCell>
                <TableCell className={`text-right font-bold ${i.isOut ? "text-red-600" : i.isLow ? "text-amber-600" : "text-[#22264B]"}`}>
                  {formatQty(i.currentStock)}
                </TableCell>
                <TableCell className="text-right text-sm">{formatQty(i.reorderLevel)}</TableCell>
                <TableCell className="text-sm">{i.storeLocation || "—"}</TableCell>
                <TableCell className="text-right text-sm">{formatMoney(i.stockValueSell)}</TableCell>
                {canViewCost && (
                  <TableCell className="text-right text-sm">
                    {i.stockValueCost != null ? formatMoney(i.stockValueCost) : "—"}
                  </TableCell>
                )}
                <TableCell>
                  {i.isOut ? (
                    <Badge variant="outline" className="border-red-600/30 bg-red-50 text-red-700">Out</Badge>
                  ) : i.isLow ? (
                    <Badge variant="outline" className="border-amber-600/30 bg-amber-50 text-amber-700">Low</Badge>
                  ) : (
                    <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-700">OK</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------- MOVEMENTS ------------------------------- */

function MovementsTab() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const movementsQuery = trpc.inventory.movements.useQuery({
    search: search || undefined,
    movementType: type === "all" ? undefined : (type as (typeof STOCK_MOVEMENT_TYPES)[number]),
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const rows = movementsQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product, SKU or reason…"
            className="pl-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[#22264B]/50">Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {STOCK_MOVEMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {MOVEMENT_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[#22264B]/50">From</Label>
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-[#22264B]/50">To</Label>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Date</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Balance after</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {movementsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!movementsQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-[#22264B]/50">
                  No movements match these filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-sm">{formatDateTime(m.createdAt)}</TableCell>
                <TableCell>
                  <Link to={`/products/${m.productId}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {m.productName}
                  </Link>
                  <span className="block text-xs text-[#22264B]/45">{m.sku}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={MOVEMENT_STYLES[m.movementType] ?? ""}>
                    {MOVEMENT_LABELS[m.movementType] ?? m.movementType}
                  </Badge>
                </TableCell>
                <TableCell className={`text-right font-bold ${m.quantity >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {m.quantity >= 0 ? "+" : ""}
                  {formatQty(m.quantity)}
                </TableCell>
                <TableCell className="text-right text-sm">{formatQty(m.balanceAfter)}</TableCell>
                <TableCell className="max-w-56 truncate text-sm" title={m.reason ?? ""}>
                  {m.reason ?? "—"}
                </TableCell>
                <TableCell className="text-sm">{m.performedByName ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------ STOCK COUNTS ------------------------------ */

function CountsTab({ canCount }: { canCount: boolean }) {
  const utils = trpc.useUtils();
  const countsQuery = trpc.inventory.listCounts.useQuery();
  const rows = countsQuery.data ?? [];

  const start = trpc.inventory.startCount.useMutation({
    onSuccess: (r) => {
      toast.success("Stock count started — enter counted quantities.");
      utils.inventory.listCounts.invalidate();
      window.location.href = `/inventory/counts/${r.id}`;
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#22264B]/55">
          Physical stock-taking: snapshot expected balances, count, then apply variances.
        </p>
        {canCount && (
          <Button
            onClick={() => start.mutate({})}
            disabled={start.isPending}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            <ClipboardList className="size-4" /> {start.isPending ? "Starting…" : "Start New Count"}
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead>Started by</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {countsQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!countsQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-[#22264B]/50">
                  No stock counts yet.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-bold text-[#22264B]">{c.reference}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={COUNT_STATUS_STYLES[c.status] ?? ""}>
                    {c.status.replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{c.itemCount}</TableCell>
                <TableCell className="text-sm">{formatDateTime(c.startedAt)}</TableCell>
                <TableCell className="text-sm">{c.completedAt ? formatDateTime(c.completedAt) : "—"}</TableCell>
                <TableCell className="text-sm">{c.startedByName ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/inventory/counts/${c.id}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ------------------------------- LOW STOCK ------------------------------- */

function LowStockTab({ canStockIn, onSupply }: { canStockIn: boolean; onSupply: (productId: number) => void }) {
  const lowQuery = trpc.inventory.lowStock.useQuery();
  const rows = lowQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <TriangleAlert className="size-4 shrink-0" />
        Products at or below their reorder level — restock these from Polar.
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Product</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead className="text-right">In stock</TableHead>
              <TableHead className="text-right">Reorder at</TableHead>
              <TableHead className="text-right">Shortfall</TableHead>
              {canStockIn && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lowQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-20 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!lowQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-[#22264B]/50">
                  Nothing is below its reorder level — stock is healthy. 🎉
                </TableCell>
              </TableRow>
            )}
            {rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link to={`/products/${p.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {p.name}
                  </Link>
                  <span className="block text-xs text-[#22264B]/45">{p.sku} · {p.packDescription}</span>
                </TableCell>
                <TableCell className="text-sm">{p.categoryName ?? "—"}</TableCell>
                <TableCell className="text-sm">{p.supplierName ?? "—"}</TableCell>
                <TableCell className={`text-right font-bold ${p.currentStock <= 0 ? "text-red-600" : "text-amber-600"}`}>
                  {formatQty(p.currentStock)}
                </TableCell>
                <TableCell className="text-right text-sm">{formatQty(p.reorderLevel)}</TableCell>
                <TableCell className="text-right text-sm text-red-600">
                  {formatQty(Math.max(0, p.reorderLevel - p.currentStock))}
                </TableCell>
                {canStockIn && (
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => onSupply(p.id)}>
                      <ArrowUpCircle className="size-4" /> Supply
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
