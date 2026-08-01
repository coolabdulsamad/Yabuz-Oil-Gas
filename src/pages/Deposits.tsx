import { useState } from "react";
import { Link } from "react-router";
import { PiggyBank, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { AccountActionDialog, type AccountActionMode } from "@/components/customers/AccountActionDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
 * YABUZ OIL & GAS — advance deposit management.
 * Money customers hold with the company: manual deposits, overpayments
 * from sales (Step 8 flows them here automatically), refunds.
 */

export default function Deposits() {
  const { hasPermission } = useAuth();
  const canRefund = hasPermission("deposits.refund");

  const [search, setSearch] = useState("");
  const [action, setAction] = useState<AccountActionMode | null>(null);
  const [selected, setSelected] = useState<{
    id: number;
    fullName: string;
    creditLimit: number;
    creditOutstanding: number;
    depositBalance: number;
  } | null>(null);

  const overviewQuery = trpc.customers.depositsOverview.useQuery();
  const data = overviewQuery.data;
  const q = search.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((c) =>
    q ? c.fullName.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) : true,
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-[#22264B]">Advance Deposits</h2>
        <p className="text-sm text-[#22264B]/55">
          Money customers hold with Yabuz — usable on future sales, refundable anytime.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Total held</p>
          <p className="mt-1 text-xl font-black text-emerald-600">{formatMoney(data?.stats.totalHeld ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Customers with balance</p>
          <p className="mt-1 text-xl font-black text-[#22264B]">{data?.stats.holders ?? 0}</p>
        </div>
        <div className="flex items-center rounded-xl border border-[#22264B]/10 bg-white p-4 text-sm text-[#22264B]/55 shadow-sm">
          <PiggyBank className="mr-3 size-8 text-[#F7A026]" />
          Overpayments on sales flow into these wallets automatically.
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
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Deposit balance</TableHead>
              <TableHead className="text-right">Outstanding credit</TableHead>
              <TableHead>Last sale</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {overviewQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!overviewQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-[#22264B]/50">
                  No deposit balances yet — record a deposit from a customer's page.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to={`/customers/${c.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {c.fullName}
                  </Link>
                  <span className="block text-xs text-[#22264B]/45">{c.code}</span>
                </TableCell>
                <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                <TableCell className="text-right font-bold text-emerald-600">{formatMoney(c.depositBalance)}</TableCell>
                <TableCell className={`text-right text-sm ${c.creditOutstanding > 0 ? "text-amber-600" : "text-[#22264B]/50"}`}>
                  {formatMoney(c.creditOutstanding)}
                </TableCell>
                <TableCell className="text-sm">{c.lastSaleAt ? formatDateTime(c.lastSaleAt) : "—"}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {canRefund && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelected({
                            id: c.id,
                            fullName: c.fullName,
                            creditLimit: c.creditLimit,
                            creditOutstanding: c.creditOutstanding,
                            depositBalance: c.depositBalance,
                          });
                          setAction("REFUND");
                        }}
                      >
                        Refund
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/customers/${c.id}`}>Ledger</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AccountActionDialog mode={action} customer={selected} onClose={() => setAction(null)} />
    </div>
  );
}
