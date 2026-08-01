import { useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { formatMoney, formatQty } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

/**
 * YABUZ OIL & GAS — analytics.
 * Visual dashboard behind analytics.view: KPIs vs the previous period,
 * daily money trend, product/rep performance, payment-method and expense
 * mixes, and the debtor watchlist.
 */

const NAVY = "#22264B";
const AMBER = "#F7A026";
const EMERALD = "#059669";
const RED = "#DC2626";
const SKY = "#0284C7";
const BEIGE = "#D7C6AD";
const PIE_COLORS = [NAVY, AMBER, EMERALD, SKY, "#8B5CF6", RED, BEIGE, "#64748B"];

type Range = { dateFrom?: string; dateTo?: string };

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "90d", label: "90 days" },
  { id: "month", label: "This month" },
] as const;

function presetRange(id: string): Range {
  const now = new Date();
  if (id === "month") return { dateFrom: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), dateTo: ymd(now) };
  const days = id === "7d" ? 7 : id === "90d" ? 90 : 30;
  return { dateFrom: ymd(new Date(now.getTime() - (days - 1) * 86400000)), dateTo: ymd(now) };
}

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0 && current === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#22264B]/40">
        <Minus className="size-3" /> no change
      </span>
    );
  }
  const pct = previous === 0 ? 100 : ((current - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(pct).toFixed(0)}% vs previous
    </span>
  );
}

function Kpi({
  label,
  value,
  current,
  previous,
  invert,
}: {
  label: string;
  value: string;
  current: number;
  previous: number;
  invert?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#22264B]/10 bg-white px-4 py-3.5">
      <p className="text-[10px] font-bold tracking-[0.14em] text-[#22264B]/45 uppercase">{label}</p>
      <p className="mt-1 text-[22px] font-extrabold text-[#22264B]">{value}</p>
      <div className={invert ? "[&_span]:![color:inherit]" : ""}>
        <Delta current={invert ? -current : current} previous={invert ? -previous : previous} />
      </div>
    </div>
  );
}

function Panel({ title, subtitle, children, tall }: { title: string; subtitle?: string; children: ReactNode; tall?: boolean }) {
  return (
    <div className="rounded-xl border border-[#22264B]/10 bg-white p-4">
      <h3 className="text-sm font-extrabold text-[#22264B]">{title}</h3>
      {subtitle && <p className="mb-2 text-[11px] text-[#22264B]/50">{subtitle}</p>}
      <div className={tall ? "h-[320px]" : "h-[260px]"}>{children}</div>
    </div>
  );
}

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-[#22264B]/40">{text}</div>
  );
}

const moneyTick = (v: number) => (Math.abs(v) >= 1_000_000 ? `₦${(v / 1_000_000).toFixed(1)}m` : Math.abs(v) >= 1000 ? `₦${(v / 1000).toFixed(0)}k` : `₦${v}`);

export default function Analytics() {
  const [preset, setPreset] = useState<string>("30d");
  const [range, setRange] = useState<Range>(() => presetRange("30d"));

  const overview = trpc.analytics.overview.useQuery(range);
  const trend = trpc.analytics.revenueTrend.useQuery(range);
  const topProducts = trpc.analytics.topProducts.useQuery(range);
  const byRep = trpc.analytics.salesByRep.useQuery(range);
  const methodMix = trpc.analytics.paymentMethodMix.useQuery(range);
  const expenseMix = trpc.analytics.expenseMix.useQuery(range);
  const debtors = trpc.analytics.topDebtors.useQuery();

  const cur = overview.data?.current;
  const prev = overview.data?.previous;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-[#22264B]">Analytics</h1>
          <p className="text-sm text-[#22264B]/50">How the business is moving — money, products, people and debt.</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-[#22264B]/5 p-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setPreset(p.id);
                setRange(presetRange(p.id));
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                preset === p.id ? "bg-[#22264B] text-white shadow-sm" : "text-[#22264B]/60 hover:text-[#22264B]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      {overview.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 bg-[#22264B]/5" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Revenue" value={formatMoney(cur?.revenue)} current={cur?.revenue ?? 0} previous={prev?.revenue ?? 0} />
          <Kpi label="Collected" value={formatMoney(cur?.collected)} current={cur?.collected ?? 0} previous={prev?.collected ?? 0} />
          <Kpi label="Gross margin" value={formatMoney(cur?.grossMargin)} current={cur?.grossMargin ?? 0} previous={prev?.grossMargin ?? 0} />
          <Kpi label="Expenses" value={formatMoney(cur?.expenses)} current={cur?.expenses ?? 0} previous={prev?.expenses ?? 0} invert />
        </div>
      )}

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-[#22264B]/10 bg-white px-4 py-3">
          <p className="text-[10px] font-bold tracking-[0.14em] text-[#22264B]/45 uppercase">Completed sales</p>
          <p className="mt-1 text-lg font-extrabold text-[#22264B]">{cur?.salesCount ?? 0}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white px-4 py-3">
          <p className="text-[10px] font-bold tracking-[0.14em] text-[#22264B]/45 uppercase">Avg sale value</p>
          <p className="mt-1 text-lg font-extrabold text-[#22264B]">{formatMoney(cur?.avgSale)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white px-4 py-3">
          <p className="text-[10px] font-bold tracking-[0.14em] text-[#22264B]/45 uppercase">Customers owe us</p>
          <p className="mt-1 text-lg font-extrabold text-red-600">{formatMoney(overview.data?.outstanding)}</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white px-4 py-3">
          <p className="text-[10px] font-bold tracking-[0.14em] text-[#22264B]/45 uppercase">Deposits we hold</p>
          <p className="mt-1 text-lg font-extrabold text-emerald-700">{formatMoney(overview.data?.depositsHeld)}</p>
        </div>
      </div>

      {/* Trend */}
      <Panel title="Money trend" subtitle="Daily revenue from completed sales vs cash confirmed vs expenses">
        {trend.isLoading ? (
          <Skeleton className="h-full w-full bg-[#22264B]/5" />
        ) : !trend.data || trend.data.every((d) => d.revenue === 0 && d.collected === 0 && d.expenses === 0) ? (
          <EmptyChart text="No activity in this window yet." />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={NAVY} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={NAVY} stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gCol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={EMERALD} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#22264B" strokeOpacity={0.08} vertical={false} />
              <XAxis
                dataKey="day"
                tickFormatter={(d: string) => d.slice(5)}
                tick={{ fontSize: 11, fill: "#22264B", opacity: 0.5 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11, fill: "#22264B", opacity: 0.5 }} tickLine={false} axisLine={false} width={60} />
              <Tooltip
                formatter={(v, name) => [formatMoney(Number(v ?? 0)), name]}
                labelFormatter={(d) => String(d)}
                contentStyle={{ borderRadius: 10, border: "1px solid #22264B22", fontSize: 12 }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="revenue" name="Revenue" stroke={NAVY} strokeWidth={2} fill="url(#gRev)" />
              <Area type="monotone" dataKey="collected" name="Collected" stroke={EMERALD} strokeWidth={2} fill="url(#gCol)" />
              <Area type="monotone" dataKey="expenses" name="Expenses" stroke={RED} strokeWidth={1.5} fill="transparent" strokeDasharray="5 3" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* Product + rep performance */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top products" subtitle="By revenue in this window">
          {topProducts.isLoading ? (
            <Skeleton className="h-full w-full bg-[#22264B]/5" />
          ) : !topProducts.data || topProducts.data.length === 0 ? (
            <EmptyChart text="No product sales yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topProducts.data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#22264B" strokeOpacity={0.08} horizontal={false} />
                <XAxis type="number" tickFormatter={moneyTick} tick={{ fontSize: 11, fill: "#22264B", opacity: 0.5 }} tickLine={false} axisLine={false} />
                <YAxis
                  type="category"
                  dataKey="productName"
                  width={150}
                  tick={{ fontSize: 10.5, fill: "#22264B" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(n: string) => (n.length > 24 ? `${n.slice(0, 23)}…` : n)}
                />
                <Tooltip
                  formatter={(v, name) =>
                    name === "Revenue" ? [formatMoney(Number(v ?? 0)), name] : [formatQty(Number(v ?? 0)), name]
                  }
                  contentStyle={{ borderRadius: 10, border: "1px solid #22264B22", fontSize: 12 }}
                />
                <Bar dataKey="revenue" name="Revenue" fill={AMBER} radius={[0, 6, 6, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Sales by rep" subtitle="Revenue and sale count per salesperson">
          {byRep.isLoading ? (
            <Skeleton className="h-full w-full bg-[#22264B]/5" />
          ) : !byRep.data || byRep.data.length === 0 ? (
            <EmptyChart text="No completed sales yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byRep.data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#22264B" strokeOpacity={0.08} vertical={false} />
                <XAxis dataKey="repName" tick={{ fontSize: 11, fill: "#22264B" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={moneyTick} tick={{ fontSize: 11, fill: "#22264B", opacity: 0.5 }} tickLine={false} axisLine={false} width={60} />
                <Tooltip
                  formatter={(v, name) =>
                    name === "Revenue" ? [formatMoney(Number(v ?? 0)), name] : [v, name]
                  }
                  contentStyle={{ borderRadius: 10, border: "1px solid #22264B22", fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill={NAVY} radius={[6, 6, 0, 0]} barSize={28} />
                <Bar dataKey="salesCount" name="Sales" fill={BEIGE} radius={[6, 6, 0, 0]} barSize={28} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Mixes + debtors */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Payment methods" subtitle="Confirmed money in, by channel">
          {methodMix.isLoading ? (
            <Skeleton className="h-full w-full bg-[#22264B]/5" />
          ) : !methodMix.data || methodMix.data.length === 0 ? (
            <EmptyChart text="No confirmed payments yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={methodMix.data}
                  dataKey="amount"
                  nameKey="method"
                  innerRadius="52%"
                  outerRadius="80%"
                  paddingAngle={3}
                >
                  {methodMix.data.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} contentStyle={{ borderRadius: 10, border: "1px solid #22264B22", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v: string) => v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Where money goes" subtitle="Approved expenses by category">
          {expenseMix.isLoading ? (
            <Skeleton className="h-full w-full bg-[#22264B]/5" />
          ) : !expenseMix.data || expenseMix.data.length === 0 ? (
            <EmptyChart text="No approved expenses yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={expenseMix.data}
                  dataKey="amount"
                  nameKey="category"
                  innerRadius="52%"
                  outerRadius="80%"
                  paddingAngle={3}
                >
                  {expenseMix.data.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(Number(v ?? 0))} contentStyle={{ borderRadius: 10, border: "1px solid #22264B22", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Debtor watchlist" subtitle="Biggest outstanding balances">
          {debtors.isLoading ? (
            <Skeleton className="h-full w-full bg-[#22264B]/5" />
          ) : !debtors.data || debtors.data.length === 0 ? (
            <EmptyChart text="Nobody owes us right now. 🎉" />
          ) : (
            <div className="h-full space-y-2.5 overflow-y-auto pr-1">
              {debtors.data.map((d) => (
                <div key={d.code} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-[#22264B]">{d.fullName}</p>
                    <p className="text-[11px] text-[#22264B]/45">
                      {d.code} · limit {formatMoney(d.creditLimit)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-extrabold text-red-600">{formatMoney(d.creditOutstanding)}</p>
                    {d.creditLimit > 0 && (
                      <div className="mt-0.5 h-1.5 w-24 overflow-hidden rounded-full bg-[#22264B]/10">
                        <div
                          className={`h-full rounded-full ${d.creditOutstanding / d.creditLimit > 0.8 ? "bg-red-500" : d.creditOutstanding / d.creditLimit > 0.5 ? "bg-amber-500" : "bg-emerald-500"}`}
                          style={{ width: `${Math.min(100, (d.creditOutstanding / d.creditLimit) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
