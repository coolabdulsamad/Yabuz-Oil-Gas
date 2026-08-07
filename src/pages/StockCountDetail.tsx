import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CheckCircle2, Printer, Search, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — stock count detail.
 * Enter physical counts per product; variances apply as COUNT_ADJUST
 * ledger movements when the count is completed. Every line is valued at
 * the selling unit price captured when the count started, so shortages
 * and surpluses show their full money value (chargeable to staff) and
 * the whole sheet is printable once completed.
 */

export default function StockCountDetail() {
  const { id } = useParams();
  const countId = Number(id);
  const navigate = useNavigate();
  const { hasPermission, user } = useAuth();
  const canCount = hasPermission("inventory.stock_count");

  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<Record<number, string>>({});
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const utils = trpc.useUtils();
  const countQuery = trpc.inventory.getCount.useQuery({ id: countId });
  const data = countQuery.data;
  const inProgress = data?.status === "IN_PROGRESS";
  const editable = canCount && inProgress;

  const save = trpc.inventory.updateCountItems.useMutation({
    onSuccess: () => {
      toast.success("Counted quantities saved.");
      utils.inventory.getCount.invalidate({ id: countId });
    },
    onError: (e) => toast.error(e.message),
  });
  const complete = trpc.inventory.completeCount.useMutation({
    onSuccess: (r) => {
      toast.success(`Count completed — ${r.adjusted} variance adjustment(s) applied.`);
      utils.inventory.getCount.invalidate({ id: countId });
      utils.inventory.listCounts.invalidate();
      utils.inventory.overview.invalidate();
      utils.inventory.movements.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const cancel = trpc.inventory.cancelCount.useMutation({
    onSuccess: () => {
      toast.success("Stock count cancelled.");
      navigate("/inventory");
    },
    onError: (e) => toast.error(e.message),
  });

  if (countQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-[#22264B]/60">Stock count not found.</p>;
  }

  /** Unit price for valuation — snapshot first, live product price as fallback. */
  const priceOf = (i: (typeof data.items)[number]) => i.unitPrice ?? i.productSellUnitPrice ?? 0;

  // Edited value wins; otherwise show the saved counted qty.
  const valueFor = (itemId: number, counted: number | null) =>
    entries[itemId] ?? (counted != null ? String(counted) : "");

  const dirtyItems = data.items
    .filter((i) => entries[i.id] !== undefined && entries[i.id] !== "")
    .map((i) => ({ itemId: i.id, countedQty: Number(entries[i.id]) }))
    .filter((i) => Number.isFinite(i.countedQty) && i.countedQty >= 0);

  const q = search.trim().toLowerCase();
  const visible = q
    ? data.items.filter((i) => i.productName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
    : data.items;

  /** Effective counted qty per item (live-typed value wins for instant totals). */
  const effectiveCounted = (i: (typeof data.items)[number]): number | null => {
    const entered = entries[i.id];
    if (entered !== undefined && entered !== "" && Number.isFinite(Number(entered))) return Number(entered);
    return i.countedQty;
  };

  const countedTotal = data.items.filter((i) => effectiveCounted(i) !== null).length;
  const varianceTotal = data.items.reduce((s, i) => s + (i.variance ?? 0), 0);

  /* ---- money totals over ALL items (not just the filtered view) ---- */
  const totals = data.items.reduce(
    (acc, i) => {
      const price = priceOf(i);
      const counted = effectiveCounted(i);
      acc.expectedValue += i.expectedQty * price;
      if (counted !== null) {
        acc.countedValue += counted * price;
        const v = counted - i.expectedQty;
        const vv = v * price;
        acc.varianceValue += vv;
        if (vv < 0) acc.shortageValue += -vv;
        if (vv > 0) acc.surplusValue += vv;
      }
      return acc;
    },
    { expectedValue: 0, countedValue: 0, varianceValue: 0, shortageValue: 0, surplusValue: 0 },
  );

  const statusStyle =
    data.status === "IN_PROGRESS"
      ? "border-amber-600/30 bg-amber-50 text-amber-700"
      : data.status === "COMPLETED"
        ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
        : "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon">
            <Link to="/inventory">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-[#22264B]">{data.reference}</h2>
              <Badge variant="outline" className={statusStyle}>
                {data.status.replace("_", " ")}
              </Badge>
            </div>
            <p className="text-sm text-[#22264B]/55">
              Started {formatDateTime(data.startedAt)} by {data.startedByName ?? "—"}
              {data.completedAt ? ` · completed ${formatDateTime(data.completedAt)}` : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" /> Print
          </Button>
          {editable && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  if (dirtyItems.length === 0) {
                    toast.error("Enter at least one counted quantity first.");
                    return;
                  }
                  save.mutate({ countId, items: dirtyItems });
                }}
                disabled={save.isPending}
              >
                {save.isPending ? "Saving…" : `Save Entries (${dirtyItems.length})`}
              </Button>
              <Button
                onClick={() => setConfirmComplete(true)}
                className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
              >
                <CheckCircle2 className="size-4" /> Complete Count
              </Button>
              <Button variant="outline" onClick={() => setConfirmCancel(true)}>
                <XCircle className="size-4" /> Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ---- valuation summary cards ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 print:hidden">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Expected value</p>
          <p className="mt-1 text-lg font-black text-[#22264B]">{formatMoney(totals.expectedValue)}</p>
          <p className="text-xs text-[#22264B]/45">{countedTotal} of {data.items.length} counted</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Counted value</p>
          <p className="mt-1 text-lg font-black text-[#22264B]">{formatMoney(totals.countedValue)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-red-700/70 uppercase">
            <TrendingDown className="size-3.5" /> Shortage value
          </div>
          <p className="mt-1 text-lg font-black text-red-600">{formatMoney(totals.shortageValue)}</p>
          <p className="text-xs text-red-600/60">chargeable to staff</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest text-emerald-700/70 uppercase">
            <TrendingUp className="size-3.5" /> Surplus value
          </div>
          <p className="mt-1 text-lg font-black text-emerald-600">{formatMoney(totals.surplusValue)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Net variance</p>
          <p className={`mt-1 text-lg font-black ${totals.varianceValue < 0 ? "text-red-600" : totals.varianceValue > 0 ? "text-emerald-600" : "text-[#22264B]"}`}>
            {totals.varianceValue < 0 ? "−" : totals.varianceValue > 0 ? "+" : ""}{formatMoney(Math.abs(totals.varianceValue))}
          </p>
          {varianceTotal !== 0 && (
            <p className={varianceTotal > 0 ? "text-xs text-emerald-600" : "text-xs text-red-600"}>
              {varianceTotal > 0 ? "+" : ""}{formatQty(varianceTotal)} packs
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 print:hidden">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product…" className="pl-9" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm print:hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Product</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Unit price</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
              <TableHead className="hidden text-right md:table-cell">Variance value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-[#22264B]/50">
                  No products match.
                </TableCell>
              </TableRow>
            )}
            {visible.map((i) => {
              const price = priceOf(i);
              const counted = effectiveCounted(i);
              const shownVariance = counted !== null ? counted - i.expectedQty : null;
              const shownValue = shownVariance !== null ? shownVariance * price : null;
              return (
                <TableRow key={i.id}>
                  <TableCell className="max-w-[160px] sm:max-w-none">
                    <span className="font-semibold text-[#22264B]">{i.productName}</span>
                    <span className="block truncate text-xs text-[#22264B]/45">
                      {i.sku} · {i.packDescription}
                      <span className="sm:hidden"> · {formatMoney(price)}</span>
                    </span>
                    {shownValue !== null && shownValue !== 0 && (
                      <span className={`block text-xs font-bold md:hidden ${shownValue > 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {shownValue > 0 ? "+" : "−"}{formatMoney(Math.abs(shownValue))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-right text-sm text-[#22264B]/70 sm:table-cell">{formatMoney(price)}</TableCell>
                  <TableCell className="text-right text-sm">{formatQty(i.expectedQty)}</TableCell>
                  <TableCell className="w-28 sm:w-40">
                    {editable ? (
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={valueFor(i.id, i.countedQty)}
                        onChange={(e) => setEntries((prev) => ({ ...prev, [i.id]: e.target.value }))}
                        className="ml-auto w-20 text-right sm:w-28"
                        placeholder="—"
                      />
                    ) : (
                      <span className="block text-right text-sm">
                        {i.countedQty != null ? formatQty(i.countedQty) : "—"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`text-right font-bold ${
                      shownVariance == null || shownVariance === 0
                        ? "text-[#22264B]/40"
                        : shownVariance > 0
                          ? "text-emerald-600"
                          : "text-red-600"
                    }`}
                  >
                    {shownVariance == null ? "—" : `${shownVariance > 0 ? "+" : ""}${formatQty(shownVariance)}`}
                  </TableCell>
                  <TableCell
                    className={`hidden text-right font-bold md:table-cell ${
                      shownValue == null || shownValue === 0
                        ? "text-[#22264B]/40"
                        : shownValue > 0
                          ? "text-emerald-600"
                          : "text-red-600"
                    }`}
                  >
                    {shownValue == null ? "—" : `${shownValue > 0 ? "+" : "−"}${formatMoney(Math.abs(shownValue))}`}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ---- printable sheet ---- */}
      <div className="hidden print:block">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-black">Yabuz Oil and Gas Ltd</h1>
            <p className="text-sm font-bold">Stock count sheet — {data.reference} ({data.status.replace("_", " ")})</p>
            <p className="text-xs text-gray-500">
              Started {formatDateTime(data.startedAt)} by {data.startedByName ?? "—"}
              {data.completedAt ? ` · completed ${formatDateTime(data.completedAt)}` : ""}
            </p>
            {data.notes && <p className="text-xs text-gray-500">Notes: {data.notes}</p>}
          </div>
          <p className="text-xs text-gray-500">Printed {formatDateTime(new Date().toISOString())} by {user?.fullName ?? ""}</p>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
          <thead>
            <tr>
              {["Product", "Unit price (₦)", "Expected", "Counted", "Variance", "Expected value (₦)", "Counted value (₦)", "Variance value (₦)"].map((h) => (
                <th key={h} style={{ borderBottom: "2px solid #22264B", textAlign: "left", padding: "4px 6px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.items.map((i) => {
              const price = priceOf(i);
              const v = i.variance;
              return (
                <tr key={i.id}>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px" }}>
                    {i.productName} <span style={{ color: "#777" }}>({i.sku})</span>
                  </td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>
                    {price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>{i.expectedQty}</td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>{i.countedQty ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right", color: v == null || v === 0 ? "#777" : v > 0 ? "green" : "red" }}>
                    {v == null ? "—" : `${v > 0 ? "+" : ""}${v}`}
                  </td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>
                    {(i.expectedQty * price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right" }}>
                    {i.countedQty != null ? (i.countedQty * price).toLocaleString(undefined, { minimumFractionDigits: 2 }) : "—"}
                  </td>
                  <td style={{ borderBottom: "1px solid #ddd", padding: "3px 6px", textAlign: "right", fontWeight: 700, color: v == null || v === 0 ? "#777" : v > 0 ? "green" : "red" }}>
                    {v == null ? "—" : `${v > 0 ? "+" : "−"}${Math.abs(v * price).toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} style={{ borderTop: "2px solid #22264B", padding: "4px 6px", fontWeight: 800 }}>TOTALS</td>
              <td style={{ borderTop: "2px solid #22264B", padding: "4px 6px", textAlign: "right", fontWeight: 800 }}>
                {totals.expectedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td style={{ borderTop: "2px solid #22264B", padding: "4px 6px", textAlign: "right", fontWeight: 800 }}>
                {totals.countedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
              <td style={{ borderTop: "2px solid #22264B", padding: "4px 6px", textAlign: "right", fontWeight: 800 }}>
                {totals.varianceValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
            <tr>
              <td colSpan={7} style={{ padding: "3px 6px", color: "red", fontWeight: 700 }}>Shortage value (chargeable)</td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: "red", fontWeight: 700 }}>
                {totals.shortageValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
            <tr>
              <td colSpan={7} style={{ padding: "3px 6px", color: "green", fontWeight: 700 }}>Surplus value</td>
              <td style={{ padding: "3px 6px", textAlign: "right", color: "green", fontWeight: 700 }}>
                {totals.surplusValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </td>
            </tr>
          </tfoot>
        </table>
        <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555" }}>
          <span>Counted by: ____________________</span>
          <span>Verified by: ____________________</span>
          <span>Approved by: ____________________</span>
        </div>
      </div>
      <style>{`@media print { body { background: white; } @page { margin: 12mm; } }`}</style>

      <AlertDialog open={confirmComplete} onOpenChange={setConfirmComplete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Complete this stock count?</AlertDialogTitle>
            <AlertDialogDescription>
              Save your entries first — completion applies every saved variance as a stock
              adjustment movement and closes the count. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => complete.mutate({ id: countId })}
              className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
            >
              {complete.isPending ? "Completing…" : "Complete & apply variances"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this stock count?</AlertDialogTitle>
            <AlertDialogDescription>
              The count and all its entries will be discarded. No stock changes are made.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancel.mutate({ id: countId })}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {cancel.isPending ? "Cancelling…" : "Cancel count"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
