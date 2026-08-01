import { useState } from "react";
import { Link } from "react-router";
import { Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * YABUZ OIL & GAS — batch price lists.
 * Mirrors the paper flow: Polar issues a list → draft a batch → publish.
 * The published list is the one feeding every product's current prices.
 */
export default function PriceLists() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("prices.manage");
  const utils = trpc.useUtils();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const listQuery = trpc.priceLists.list.useQuery();

  const createMutation = trpc.priceLists.create.useMutation({
    onSuccess: (r) => {
      toast.success(`Draft created with ${r.cloned} item(s) — edit prices, then publish.`);
      setCreateOpen(false);
      setName("");
      setDescription("");
      utils.priceLists.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Price Lists</h2>
          <p className="mt-0.5 text-sm text-[#22264B]/60">
            Every batch Polar issues, preserved. Publishing a batch updates all product prices.
          </p>
        </div>
        {canManage && (
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            <Plus className="mr-2 h-4 w-4" /> Draft new batch
          </Button>
        )}
      </div>

      {listQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : (listQuery.data ?? []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#22264B]/20 bg-white/60 px-6 py-14 text-center">
          <Tags className="mx-auto h-8 w-8 text-[#22264B]/25" />
          <p className="mt-3 text-sm text-[#22264B]/50">No price lists yet.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(listQuery.data ?? []).map((l) => (
            <Link
              key={l.id}
              to={`/price-lists/${l.id}`}
              className="group flex flex-col rounded-2xl border border-[#22264B]/10 bg-white p-5 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-black tracking-tight text-[#22264B]">{l.name}</h3>
                {l.isActive ? (
                  <Badge className="border-0 bg-[#F7A026] font-semibold text-[#22264B] hover:bg-[#F7A026]">
                    Published
                  </Badge>
                ) : l.approvalStatus === "APPROVED" ? (
                  <Badge variant="outline" className="border-[#22264B]/20 text-[#22264B]/60">
                    Archived
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-[#F7A026]/50 bg-[#F7A026]/10 text-[#8a5a00]">
                    Draft
                  </Badge>
                )}
              </div>
              {l.description && (
                <p className="mt-2 line-clamp-2 text-sm text-[#22264B]/60">{l.description}</p>
              )}
              <div className="mt-auto space-y-1 pt-4 text-xs text-[#22264B]/55">
                <p>{l.itemCount} product{l.itemCount === 1 ? "" : "s"}</p>
                {l.isActive && l.effectiveFrom && (
                  <p>Effective {formatDateTime(l.effectiveFrom)}</p>
                )}
                <p>Created {formatDate(l.createdAt)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#22264B]">Draft a new price batch</DialogTitle>
            <DialogDescription>
              The draft starts as a copy of the current published list — adjust only what changed
              on Polar's new sheet, then publish.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pl-name">Batch name</Label>
              <Input
                id="pl-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. BATCH C — SEPT 2025"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-desc">Description <span className="text-[#22264B]/40">(optional)</span></Label>
              <Textarea
                id="pl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="e.g. New producer prices from Polar effective October"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={name.trim().length < 2 || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: name.trim(), description })}
              className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
            >
              {createMutation.isPending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
