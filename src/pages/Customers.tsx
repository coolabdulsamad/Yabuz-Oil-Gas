import { useState } from "react";
import { Link } from "react-router";
import { Plus, Search } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatMoney } from "@/lib/format";
import { CustomerFormDialog, type EditableCustomer } from "@/components/customers/CustomerFormDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { CUSTOMER_STATUSES } from "@contracts/constants";

/**
 * YABUZ OIL & GAS — customer directory.
 * Each customer carries two wallets: outstanding credit (they owe us)
 * and advance deposits (they hold money with us).
 */

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "border-emerald-600/30 bg-emerald-50 text-emerald-700",
  INACTIVE: "border-[#22264B]/20 bg-[#22264B]/5 text-[#22264B]/50",
  BLOCKED: "border-red-600/30 bg-red-50 text-red-700",
};

export default function Customers() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("customers.manage");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [editor, setEditor] = useState<EditableCustomer | null | undefined>(undefined);

  const listQuery = trpc.customers.list.useQuery({
    search: search || undefined,
    status: status === "all" ? undefined : (status as (typeof CUSTOMER_STATUSES)[number]),
  });
  const rows = listQuery.data ?? [];

  const totals = {
    count: rows.length,
    outstanding: rows.reduce((s, r) => s + r.creditOutstanding, 0),
    deposits: rows.reduce((s, r) => s + r.depositBalance, 0),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight text-[#22264B]">Customers</h2>
          <p className="text-sm text-[#22264B]/55">
            {totals.count} account(s) · {formatMoney(totals.outstanding)} outstanding ·{" "}
            {formatMoney(totals.deposits)} held in deposits
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setEditor(null)} className="bg-[#22264B] text-white hover:bg-[#22264B]/90">
            <Plus className="size-4" /> New Customer
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#22264B]/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, business, phone or code…"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {CUSTOMER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#22264B]/10 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-[#22264B]/[0.03]">
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead className="text-right">Credit limit</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">Deposit wallet</TableHead>
              <TableHead className="text-right">Total spent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {listQuery.isLoading && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-24 w-full" />
                </TableCell>
              </TableRow>
            )}
            {!listQuery.isLoading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-[#22264B]/50">
                  No customers found — add your first customer to start selling.
                </TableCell>
              </TableRow>
            )}
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to={`/customers/${c.id}`} className="font-semibold text-[#22264B] hover:text-[#F7A026]">
                    {c.fullName}
                  </Link>
                  <span className="block text-xs text-[#22264B]/45">
                    {c.code}
                    {c.businessName ? ` · ${c.businessName}` : ""}
                  </span>
                </TableCell>
                <TableCell className="text-sm">{c.phone ?? "—"}</TableCell>
                <TableCell className="text-right text-sm">
                  {c.creditLimit > 0 ? formatMoney(c.creditLimit) : "Cash only"}
                </TableCell>
                <TableCell
                  className={`text-right text-sm font-semibold ${
                    c.creditOutstanding > 0
                      ? c.creditLimit > 0 && c.creditOutstanding > c.creditLimit
                        ? "text-red-600"
                        : "text-amber-600"
                      : "text-[#22264B]/50"
                  }`}
                >
                  {formatMoney(c.creditOutstanding)}
                </TableCell>
                <TableCell className={`text-right text-sm font-semibold ${c.depositBalance > 0 ? "text-emerald-600" : "text-[#22264B]/50"}`}>
                  {formatMoney(c.depositBalance)}
                </TableCell>
                <TableCell className="text-right text-sm">{formatMoney(c.totalSpent)}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_STYLES[c.status] ?? ""}>
                    {c.status.charAt(0) + c.status.slice(1).toLowerCase()}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {canManage && (
                      <Button
                        variant="outline"
                        size="sm"
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
                        Edit
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/customers/${c.id}`}>Open</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CustomerFormDialog customer={editor} onClose={() => setEditor(undefined)} />
    </div>
  );
}
