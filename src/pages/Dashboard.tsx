import { Link } from "react-router";
import {
  AlertTriangle,
  Boxes,
  CheckSquare,
  Package,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney, formatQty } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * YABUZ OIL & GAS — dashboard.
 * Headline numbers; grows with each module.
 */
export default function Dashboard() {
  const { user } = useAuth();
  const stats = trpc.dashboard.stats.useQuery();

  const canSeeCost = stats.data ? stats.data.costValue !== null : true;

  const cards = [
    {
      label: canSeeCost ? "Inventory value (cost)" : "Inventory value",
      value: stats.data ? formatMoney(canSeeCost ? stats.data.costValue : stats.data.sellValue) : null,
      sub: stats.data
        ? canSeeCost
          ? `${formatMoney(stats.data.sellValue)} at selling price`
          : "Valued at selling price"
        : null,
      icon: Boxes,
      to: "/inventory",
    },
    {
      label: "Active products",
      value: stats.data ? String(stats.data.productCount) : null,
      sub: stats.data ? `${stats.data.lowStockCount} at/below reorder level` : null,
      icon: Package,
      to: "/products",
    },
    {
      label: "Customers",
      value: stats.data ? String(stats.data.customerCount) : null,
      sub: "Credit & deposit accounts",
      icon: Users,
      to: "/customers",
    },
    {
      label: "Pending approvals",
      value: stats.data ? String(stats.data.pendingApprovals) : null,
      sub: "Waiting in the workflow",
      icon: CheckSquare,
      to: "/approvals",
    },
    {
      label: "Total revenue",
      value: stats.data ? formatMoney(stats.data.totalRevenue) : null,
      sub: stats.data ? `${stats.data.totalSales} sales recorded` : null,
      icon: Wallet,
      to: "/sales",
    },
    ...(canSeeCost
      ? [
          {
            label: "Expected margin on stock",
            value: stats.data ? formatMoney(stats.data.sellValue - (stats.data.costValue ?? 0)) : null,
            sub: "Sell value − cost value",
            icon: TrendingUp,
            to: "/reports",
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Greeting */}
      <div className="rounded-2xl bg-[#22264B] px-6 py-6 text-white sm:px-8">
        <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[#F7A026]">
          Yabuz Oil & Gas Ltd
        </p>
        <h2 className="mt-1.5 text-2xl font-black tracking-tight sm:text-[28px]">
          Welcome back, {user?.fullName.split(" ")[0]}.
        </h2>
        <p className="mt-1.5 max-w-lg text-sm text-[#D7C6AD]/75">
          Here's the state of the business — stock, money, customers and anything waiting
          for approval.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="group rounded-2xl border border-[#22264B]/10 bg-white p-5 transition-shadow hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-semibold uppercase tracking-wide text-[#22264B]/50">
                {c.label}
              </p>
              <c.icon className="size-[18px] text-[#F7A026]" strokeWidth={2.2} />
            </div>
            {c.value == null ? (
              <Skeleton className="mt-3 h-8 w-28" />
            ) : (
              <p className="mt-2 text-[26px] font-black tabular-nums tracking-tight text-[#22264B]">
                {c.value}
              </p>
            )}
            <p className="mt-1 text-xs text-[#22264B]/50">{c.sub ?? " "}</p>
          </Link>
        ))}
      </div>

      {/* Low stock watchlist */}
      <div className="rounded-2xl border border-[#22264B]/10 bg-white">
        <div className="flex items-center gap-2 border-b border-[#22264B]/8 px-5 py-4">
          <AlertTriangle className="size-4 text-[#F7A026]" />
          <h3 className="text-[15px] font-bold text-[#22264B]">Low stock watchlist</h3>
        </div>
        {stats.isLoading ? (
          <div className="space-y-2 p-5">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : !stats.data?.lowStock.length ? (
          <p className="px-5 py-6 text-sm text-[#22264B]/55">
            No product is below its reorder level right now.
          </p>
        ) : (
          <ul className="divide-y divide-[#22264B]/6">
            {stats.data.lowStock.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm font-medium text-[#22264B]">{p.name}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-bold tabular-nums",
                    p.currentStock <= 0
                      ? "bg-red-100 text-red-700"
                      : "bg-[#F7A026]/15 text-[#8a5a08]",
                  )}
                >
                  {formatQty(p.currentStock)} packs left
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
