import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Plus, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — sales register.
 * Staff see their own sales; sales.view_all sees everyone's.
 */

export const SALE_STATUS_STYLES: Record<string, string> = {
  DRAFT: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/70",
  ON_HOLD: "border-violet-600/30 bg-violet-50 text-violet-700",
  PENDING_APPROVAL: "border-amber-600/30 bg-amber-50 text-amber-700",
  APPROVED: "border-sky-600/30 bg-sky-50 text-sky-700",
  REJECTED: "border-red-600/30 bg-red-50 text-red-700",
  COMPLETED: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  CANCELLED: "border-[#22264B]/15 bg-[#22264B]/5 text-[#22264B]/45",
};

export const SALE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ON_HOLD: "On hold",
  PENDING_APPROVAL: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const SALE_PAYMENT_STYLES: Record<string, string> = {
  UNPAID: "border-red-600/30 bg-red-50 text-red-700",
  PARTIAL: "border-amber-600/30 bg-amber-50 text-amber-700",
  PAID: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  OVERPAID: "border-sky-600/30 bg-sky-50 text-sky-700",
};

export const PAYMENT_MODE_LABELS: Record<string, string> = {
  PAY_LATER: "Pay later",
  CREDIT: "Credit",
  DEPOSIT: "Deposit wallet",
};

const STATUS_TABS = ["ALL", "DRAFT", "ON_HOLD", "PENDING_APPROVAL", "COMPLETED", "REJECTED", "CANCELLED"] as const;

export default function Sales() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const canCreate = hasPermission("sales.create");
  const canViewAll = hasPermission("sales.view_all");

  const [tab, setTab] = useState<(typeof STATUS_TABS)[number]>("ALL");
  const [search, setSearch] = useState("");

  const listQuery = trpc.sales.list.useQuery({
    status: tab === "ALL" ? undefined : tab,
    search: search.trim() || undefined,
  });
  const rows = listQuery.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Sales</h2>
          <p className="text-sm text-[#22264B]/55">
            {canViewAll ? "Every sale across the company." : "Your sales — drafts, held, pending and completed."}
          </p>
        </div>
        {canCreate && (
          <Button className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]" onClick={() => navigate("/sales/new")}>
            <Plus className="mr-1 size-4" /> New Sale
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList className="flex-wrap">
            {STATUS_TABS.map((s) => (
              <TabsTrigger key={s} value={s}>
                {s === "ALL" ? "All" : SALE_STATUS_LABELS[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order no / notes…" className="pl-9" />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              {canViewAll && <TableHead>Sales rep</TableHead>}
              <TableHead className="text-center">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={canViewAll ? 9 : 8}>
                  <Skeleton className="h-32 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!listQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={canViewAll ? 9 : 8} className="py-12 text-center text-sm text-[#22264B]/50">
                  No sales here yet.{canCreate && tab === "ALL" && " Hit “New Sale” to make your first one."}
                </TableCell>
              </TableRow>
            )}
            {rows.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link to={`/sales/${s.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {s.orderNo}
                  </Link>
                  <span className="block text-xs text-[#22264B]/45">{formatDateTime(s.createdAt)}</span>
                </TableCell>
                <TableCell className="text-sm">{s.customerName ?? <span className="text-[#22264B]/40">Walk-in</span>}</TableCell>
                {canViewAll && <TableCell className="text-sm">{s.repName}</TableCell>}
                <TableCell className="text-center text-sm">{s.itemCount}</TableCell>
                <TableCell className="text-right font-bold text-[#22264B]">{formatMoney(s.grandTotal)}</TableCell>
                <TableCell>
                  <span className="text-xs font-semibold text-[#22264B]/60">{PAYMENT_MODE_LABELS[s.paymentMode]}</span>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={SALE_PAYMENT_STYLES[s.paymentStatus]}>
                    {s.paymentStatus}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={SALE_STATUS_STYLES[s.status]}>
                    {SALE_STATUS_LABELS[s.status] ?? s.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/sales/${s.id}`}>Open</Link>
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
