import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, CheckCircle2, Search, XCircle } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatQty } from "@/lib/format";
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
 * ledger movements when the count is completed.
 */

export default function StockCountDetail() {
  const { id } = useParams();
  const countId = Number(id);
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
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

  const countedTotal = data.items.filter((i) => i.countedQty !== null).length;
  const varianceTotal = data.items.reduce((s, i) => s + (i.variance ?? 0), 0);

  const statusStyle =
    data.status === "IN_PROGRESS"
      ? "border-amber-600/30 bg-amber-50 text-amber-700"
      : data.status === "COMPLETED"
        ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
        : "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        {editable && (
          <div className="flex gap-2">
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
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product…" className="pl-9" />
        </div>
        <p className="text-sm text-[#22264B]/55">
          {countedTotal} of {data.items.length} counted
          {varianceTotal !== 0 && (
            <span className={varianceTotal > 0 ? "text-emerald-600" : "text-red-600"}>
              {" "}· net variance {varianceTotal > 0 ? "+" : ""}
              {formatQty(varianceTotal)} packs
            </span>
          )}
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Expected</TableHead>
              <TableHead className="text-right">Counted</TableHead>
              <TableHead className="text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-sm text-[#22264B]/50">
                  No products match.
                </TableCell>
              </TableRow>
            )}
            {visible.map((i) => {
              const entered = entries[i.id];
              const shownVariance =
                entered !== undefined && entered !== "" && Number.isFinite(Number(entered))
                  ? Number(entered) - i.expectedQty
                  : i.variance;
              return (
                <TableRow key={i.id}>
                  <TableCell>
                    <span className="font-semibold text-[#22264B]">{i.productName}</span>
                    <span className="block text-xs text-[#22264B]/45">{i.sku} · {i.packDescription}</span>
                  </TableCell>
                  <TableCell className="text-right text-sm">{formatQty(i.expectedQty)}</TableCell>
                  <TableCell className="w-40">
                    {editable ? (
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        value={valueFor(i.id, i.countedQty)}
                        onChange={(e) => setEntries((prev) => ({ ...prev, [i.id]: e.target.value }))}
                        className="ml-auto w-28 text-right"
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

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
