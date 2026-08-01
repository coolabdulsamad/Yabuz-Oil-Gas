import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  ArrowLeft,
  Ban,
  CircleCheck,
  HandCoins,
  PiggyBank,
  Scale,
  SlidersHorizontal,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney } from "@/lib/format";
import { CustomerFormDialog, type EditableCustomer } from "@/components/customers/CustomerFormDialog";
import { AccountActionDialog, type AccountActionMode } from "@/components/customers/AccountActionDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { CUSTOMER_TRANSACTION_TYPES } from "@contracts/constants";

/**
 * YABUZ OIL & GAS — customer account page.
 * Profile, credit position vs limit, deposit wallet, and the full
 * double-purpose ledger (credit + deposit movements).
 */

const TX_STYLES: Record<string, string> = {
  SALE_DEBIT: "border-red-600/30 bg-red-50 text-red-700",
  PAYMENT_CREDIT: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  DEPOSIT_IN: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  DEPOSIT_USED: "border-sky-600/30 bg-sky-50 text-sky-700",
  DEPOSIT_REFUND: "border-amber-600/30 bg-amber-50 text-amber-700",
  ADJUSTMENT: "border-violet-600/30 bg-violet-50 text-violet-700",
};

const TX_LABELS: Record<string, string> = {
  SALE_DEBIT: "Credit sale",
  PAYMENT_CREDIT: "Payment received",
  DEPOSIT_IN: "Deposit in",
  DEPOSIT_USED: "Deposit used",
  DEPOSIT_REFUND: "Deposit refund",
  ADJUSTMENT: "Adjustment",
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
  BLOCKED: "border-red-600/30 bg-red-50 text-red-700",
};

function signed(value: number, prefixPlus = true): string {
  if (value === 0) return "—";
  return `${value > 0 && prefixPlus ? "+" : ""}${formatMoney(value)}`;
}

export default function CustomerDetail() {
  const { id } = useParams();
  const customerId = Number(id);
  const { hasPermission } = useAuth();
  const canManage = hasPermission("customers.manage");
  const canCreditManage = hasPermission("credit.manage");
  const canDeposit = hasPermission("deposits.record");
  const canRefund = hasPermission("deposits.refund");

  const [txType, setTxType] = useState<string>("all");
  const [editor, setEditor] = useState<EditableCustomer | null | undefined>(undefined);
  const [action, setAction] = useState<AccountActionMode | null>(null);

  const utils = trpc.useUtils();
  const customerQuery = trpc.customers.getById.useQuery({ id: customerId });
  const ledgerQuery = trpc.customers.ledger.useQuery({
    customerId,
    transactionType: txType === "all" ? undefined : (txType as (typeof CUSTOMER_TRANSACTION_TYPES)[number]),
  });

  const setStatus = trpc.customers.setStatus.useMutation({
    onSuccess: () => {
      toast.success("Customer status updated.");
      utils.customers.getById.invalidate({ id: customerId });
      utils.customers.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (customerQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }
  const c = customerQuery.data;
  if (!c) return <p className="text-sm text-[#22264B]/60">Customer not found.</p>;

  const rows = ledgerQuery.data ?? [];
  const utilization = c.creditLimit > 0 ? Math.min(100, Math.round((c.creditOutstanding / c.creditLimit) * 100)) : 0;
  const overLimit = c.creditLimit > 0 && c.creditOutstanding > c.creditLimit;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="outline" size="icon">
            <Link to="/customers">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-black tracking-tight text-[#22264B]">{c.fullName}</h2>
              <Badge variant="outline" className={STATUS_STYLES[c.status] ?? ""}>
                {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
              </Badge>
              <Badge variant="outline" className="border-[#22264B]/20 bg-[#22264B]/5 font-mono text-[#22264B]/60">
                {c.code}
              </Badge>
            </div>
            <p className="text-sm text-[#22264B]/55">
              {c.businessName ? `${c.businessName} · ` : ""}
              {c.phone ?? "no phone"}
              {c.email ? ` · ${c.email}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canDeposit && (
            <Button onClick={() => setAction("DEPOSIT")} className="bg-[#22264B] text-white hover:bg-[#22264B]/90">
              <PiggyBank className="size-4" /> Record Deposit
            </Button>
          )}
          {canRefund && c.depositBalance > 0 && (
            <Button variant="outline" onClick={() => setAction("REFUND")}>
              <Undo2 className="size-4" /> Refund Deposit
            </Button>
          )}
          {canCreditManage && (
            <>
              <Button variant="outline" onClick={() => setAction("LIMIT")}>
                <HandCoins className="size-4" /> Credit Limit
              </Button>
              <Button variant="outline" onClick={() => setAction("ADJUST")}>
                <SlidersHorizontal className="size-4" /> Adjust Credit
              </Button>
            </>
          )}
          {canManage && (
            <Button
              variant="outline"
              onClick={() =>
                setEditor({
                  id: c.id,
                  fullName: c.fullName,
                  businessName: c.businessName,
                  phone: c.phone,
                  email: c.email,
                  address: c.address,
                  notes: c.notes,
                  creditLimit: c.creditLimit,
                })
              }
            >
              Edit Profile
            </Button>
          )}
          {canManage &&
            (c.status === "ACTIVE" ? (
              <Button
                variant="outline"
                className="text-red-600"
                onClick={() => setStatus.mutate({ id: c.id, status: "BLOCKED" })}
                disabled={setStatus.isPending}
              >
                <Ban className="size-4" /> Block
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-emerald-600"
                onClick={() => setStatus.mutate({ id: c.id, status: "ACTIVE" })}
                disabled={setStatus.isPending}
              >
                <CircleCheck className="size-4" /> Reactivate
              </Button>
            ))}
        </div>
      </div>

      {/* Wallets */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Outstanding credit</p>
          <p className={`mt-1 text-2xl font-black ${overLimit ? "text-red-600" : c.creditOutstanding > 0 ? "text-amber-600" : "text-[#22264B]"}`}>
            {formatMoney(c.creditOutstanding)}
          </p>
          {c.creditLimit > 0 ? (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-[#22264B]/10">
                <div
                  className={`h-full rounded-full ${overLimit ? "bg-red-500" : "bg-[#F7A026]"}`}
                  style={{ width: `${utilization}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-[#22264B]/50">
                {utilization}% of {formatMoney(c.creditLimit)} limit
                {overLimit && <span className="font-bold text-red-600"> — over limit!</span>}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-[#22264B]/50">Cash-only customer (no credit limit)</p>
          )}
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Deposit wallet</p>
          <p className={`mt-1 text-2xl font-black ${c.depositBalance > 0 ? "text-emerald-600" : "text-[#22264B]"}`}>
            {formatMoney(c.depositBalance)}
          </p>
          <p className="mt-1 text-xs text-[#22264B]/50">Money held with Yabuz — usable on future sales</p>
        </div>
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-widest text-[#22264B]/45 uppercase">Lifetime purchases</p>
          <p className="mt-1 text-2xl font-black text-[#22264B]">{formatMoney(c.totalSpent)}</p>
          <p className="mt-1 text-xs text-[#22264B]/50">
            {c.lastSaleAt ? `Last sale ${formatDateTime(c.lastSaleAt)}` : "No sales yet"}
          </p>
        </div>
      </div>

      {(c.address || c.notes) && (
        <div className="rounded-xl border border-[#22264B]/10 bg-white p-4 text-sm text-[#22264B]/70 shadow-sm">
          {c.address && (
            <p>
              <span className="font-bold text-[#22264B]">Address: </span>
              {c.address}
            </p>
          )}
          {c.notes && (
            <p className={c.address ? "mt-1" : ""}>
              <span className="font-bold text-[#22264B]">Notes: </span>
              {c.notes}
            </p>
          )}
        </div>
      )}

      {/* Ledger */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-base font-black text-[#22264B]">
            <Scale className="size-4" /> Account Ledger
          </h3>
          <Select value={txType} onValueChange={setTxType}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              {CUSTOMER_TRANSACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {TX_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#22264B]/[0.03]">
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Credit change</TableHead>
                <TableHead className="text-right">Deposit change</TableHead>
                <TableHead className="text-right">Outstanding after</TableHead>
                <TableHead className="text-right">Wallet after</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledgerQuery.isLoading && (
                <TableRow>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-24 w-full" />
                  </TableCell>
                </TableRow>
              )}
              {!ledgerQuery.isLoading && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-[#22264B]/50">
                    No account movements yet.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(t.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={TX_STYLES[t.transactionType] ?? ""}>
                      {TX_LABELS[t.transactionType] ?? t.transactionType}
                    </Badge>
                  </TableCell>
                  <TableCell className={`text-right text-sm font-semibold ${t.creditDelta > 0 ? "text-red-600" : t.creditDelta < 0 ? "text-emerald-600" : "text-[#22264B]/40"}`}>
                    {signed(t.creditDelta)}
                  </TableCell>
                  <TableCell className={`text-right text-sm font-semibold ${t.depositDelta > 0 ? "text-emerald-600" : t.depositDelta < 0 ? "text-amber-600" : "text-[#22264B]/40"}`}>
                    {signed(t.depositDelta)}
                  </TableCell>
                  <TableCell className="text-right text-sm">{formatMoney(t.creditBalanceAfter)}</TableCell>
                  <TableCell className="text-right text-sm">{formatMoney(t.depositBalanceAfter)}</TableCell>
                  <TableCell className="max-w-56 truncate text-sm" title={t.notes ?? ""}>
                    {t.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{t.performedByName ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <CustomerFormDialog customer={editor} onClose={() => setEditor(undefined)} />
      <AccountActionDialog
        mode={action}
        customer={{
          id: c.id,
          fullName: c.fullName,
          creditLimit: c.creditLimit,
          creditOutstanding: c.creditOutstanding,
          depositBalance: c.depositBalance,
        }}
        onClose={() => setAction(null)}
      />
    </div>
  );
}
