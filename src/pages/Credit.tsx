import { useState } from "react";
import { Link } from "react-router";
import { Search, TriangleAlert } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { AccountActionDialog, type AccountActionMode } from "@/components/customers/AccountActionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * YABUZ OIL & GAS — credit management.
 * Every customer carrying debt or holding a credit limit, with limit
 * utilization, over-limit alerts and quick limit/adjust actions.
 */

export default function Credit() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("credit.manage");

  const [search, setSearch] = useState("");
  const [action, setAction] = useState<AccountActionMode | null>(null);
  const [selected, setSelected] = useState<{
    id: number;
    fullName: string;
    creditLimit: number;
    creditOutstanding: number;
    depositBalance: number;
  } | null>(null);

  const overviewQuery = trpc.customers.creditOverview.useQuery();
  const data = overviewQuery.data;
  const q = search.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((c) =>
    q ? c.fullName.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) : true,
  );

  const openAction = (mode: AccountActionMode, c: (typeof rows)[number]) => {
    setSelected({
      id: c.id,
      fullName: c.fullName,
      creditLimit: c.creditLimit,
      creditOutstanding: c.creditOutstanding,
      depositBalance: c.depositBalance,
    });
    setAction(mode);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-[#22264B]">Credit Management</h2>
        <p className="text-sm text-[#22264B]/55">
          Outstanding debts, credit limits and repayment tracking.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Total outstanding</p>
          <p className="mt-1 text-xl font-black text-amber-600">{formatMoney(data?.stats.totalOutstanding ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Customers owing</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{data?.stats.debtors ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Over limit</p>
          <p className={`mt-1 text-xl font-black ${(data?.stats.overLimit ?? 0) > 0 ? "text-red-600" : "text-[#22264B]"}`}>
            {data?.stats.overLimit ?? 0}
          </p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Limits granted</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{formatMoney(data?.stats.totalLimit ?? 0)}</p>
        </div>
      </div>

      <div className="relative w-full max-w-xs">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customer…" className="pl-9" />
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Customer</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Credit limit</TableHead>
              <TableHead className="w-44">Utilization</TableHead>
              <TableHead>Last sale</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overviewQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!overviewQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-[#22264B]/50">
                  No credit accounts — nobody owes the company right now. 🎉
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => {
              const overLimit = c.creditLimit > 0 && c.creditOutstanding > c.creditLimit;
              const pct = c.creditLimit > 0 ? Math.min(100, Math.round((c.creditOutstanding / c.creditLimit) * 100)) : 0;
              return (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link to={`/customers/${c.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                      {c.fullName}
                    </Link>
                    <span className="block text-xs text-[#22264B]/45">{c.code}</span>
                  </TableCell>
                  <TableCell className={`text-right font-bold ${overLimit ? "text-red-600" : c.creditOutstanding > 0 ? "text-amber-600" : "text-[#22264B]/50"}`}>
                    {formatMoney(c.creditOutstanding)}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {c.creditLimit > 0 ? formatMoney(c.creditLimit) : "Cash only"}
                  </TableCell>
                  <TableCell>
                    {c.creditLimit > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#22264B]/10">
                          <div
                            className={`h-full rounded-full ${overLimit ? "bg-red-500" : "bg-[#F7A026]"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-9 text-right text-xs text-[#22264B]/50">{pct}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-[#22264B]/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{c.lastSaleAt ? formatDateTime(c.lastSaleAt) : "—"}</TableCell>
                  <TableCell>
                    {overLimit ? (
                      <Badge variant="outline" className="border-red-600/30 bg-red-50 text-red-700">
                        <TriangleAlert className="mr-1 size-3" /> Over limit
                      </Badge>
                    ) : c.creditOutstanding > 0 ? (
                      <Badge variant="outline" className="border-amber-600/30 bg-amber-50 text-amber-700">Owing</Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-600/30 bg-emerald-50 text-emerald-700">Clear</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {canManage && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => openAction("LIMIT", c)}>
                            Limit
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openAction("ADJUST", c)}>
                            Adjust
                          </Button>
                        </>
                      )}
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/customers/${c.id}`}>Ledger</Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AccountActionDialog mode={action} customer={selected} onClose={() => setAction(null)} />
    </div>
  );
}
