import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * YABUZ OIL & GAS — printable staff payslip.
 * Standalone page (no app shell) opened from Salary Management.
 * Full earnings/deductions breakdown incl. loan deductions and the
 * staff bank details the payment goes to.
 */

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export default function Payslip() {
  const { id } = useParams();
  const payId = Number(id);
  const { isAuthenticated, isLoading: authLoading } = useAuth({ redirectOnUnauthenticated: true });

  const query = trpc.salary.getPayslip.useQuery({ id: payId }, { enabled: isAuthenticated });
  const identityQ = trpc.settings.businessIdentity.useQuery(undefined, { enabled: isAuthenticated });

  const data = query.data;
  const identity = (identityQ.data ?? {}) as Record<string, unknown>;
  const businessName = typeof identity["business.name"] === "string" ? (identity["business.name"] as string) : "Yabuz Oil & Gas Ltd";
  const businessAddress = typeof identity["business.address"] === "string" ? (identity["business.address"] as string) : "";
  const businessPhone = typeof identity["business.phone"] === "string" ? (identity["business.phone"] as string) : "";
  const rcNumber = typeof identity["business.rc_number"] === "string" ? (identity["business.rc_number"] as string) : "";

  useEffect(() => {
    document.title = data ? `Payslip ${data.pay.reference}` : "Payslip";
  }, [data]);

  if (authLoading || query.isLoading || identityQ.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-8">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[28rem] w-full" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-24 text-center">
        <p className="text-sm text-[#22264B]/60">Payslip not found.</p>
        <Button asChild variant="outline" className="mt-4"><Link to="/salary">Back to payroll</Link></Button>
      </div>
    );
  }

  const { pay, staff, paidByName, loanDeductions } = data;
  const period = `${MONTHS[pay.periodMonth - 1]} ${pay.periodYear}`;

  const num = (v: string | number | null | undefined) => Number(v ?? 0);
  const bonus = num(pay.bonus);
  const loanDed = num(pay.loanDeduction);

  const earnings: [string, number][] = [
    ["Basic salary", num(pay.basic)],
    ["Housing allowance", num(pay.housing)],
    ["Transport allowance", num(pay.transport)],
    ["Meal allowance", num(pay.meal)],
    ["Other allowances", num(pay.otherAllowance)],
  ];
  if (bonus > 0) earnings.push([`Bonus${pay.bonusNote ? ` (${pay.bonusNote})` : ""}`, bonus]);

  const deductions: [string, number][] = [
    ["PAYE tax", num(pay.taxAmount)],
    ["Pension", num(pay.pensionAmount)],
    ["VAT", num(pay.vatAmount)],
    ["Other deductions", num(pay.otherDeduction)],
  ];
  if (loanDed > 0) deductions.push(["Loan repayment", loanDed]);

  const shownEarnings = earnings.filter(([, v]) => v > 0);
  const shownDeductions = deductions.filter(([, v]) => v > 0);

  return (
    <div className="mx-auto max-w-3xl p-6 print:p-0">
      {/* Toolbar (hidden when printing) */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Button asChild variant="outline" size="sm">
          <Link to="/salary"><ArrowLeft className="mr-2 size-4" /> Back to payroll</Link>
        </Button>
        <Button size="sm" onClick={() => window.print()}><Printer className="mr-2 size-4" /> Print payslip</Button>
      </div>

      <div className="rounded-xl border border-[#22264B]/15 bg-white p-8 print:rounded-none print:border-0">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-[#22264B] pb-4">
          <div>
            <h1 className="text-xl font-black tracking-tight text-[#22264B]">{businessName}</h1>
            {businessAddress && <p className="text-xs text-[#22264B]/60">{businessAddress}</p>}
            <p className="text-xs text-[#22264B]/60">
              {[businessPhone, rcNumber ? `RC ${rcNumber}` : ""].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="text-right">
            <p className="text-lg font-black tracking-wide text-[#F7A026]">PAYSLIP</p>
            <p className="text-sm font-bold text-[#22264B]">{pay.reference}</p>
            <p className="text-xs text-[#22264B]/60">Pay period: {period}</p>
            <p className={`mt-1 inline-block rounded px-2 py-0.5 text-[11px] font-bold ${pay.status === "PAID" ? "bg-emerald-100 text-emerald-700" : pay.status === "PENDING" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"}`}>
              {pay.status}
            </p>
          </div>
        </div>

        {/* Staff + bank */}
        <div className="grid grid-cols-2 gap-6 border-b border-[#22264B]/10 py-4 text-sm">
          <div>
            <p className="mb-1 text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Staff</p>
            <p className="font-bold text-[#22264B]">{staff?.fullName}</p>
            <p className="text-xs text-[#22264B]/60">{staff?.staffCode} · {staff?.jobTitle ?? staff?.role}{staff?.department ? ` · ${staff.department}` : ""}</p>
            {staff?.dateEmployed && <p className="text-xs text-[#22264B]/60">Employed: {formatDate(staff.dateEmployed)}</p>}
          </div>
          <div className="text-right">
            <p className="mb-1 text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Payment to</p>
            {staff?.bankName ? (
              <>
                <p className="font-bold text-[#22264B]">{staff.bankName}</p>
                <p className="text-xs text-[#22264B]/60">{staff.bankAccountNumber} · {staff.bankAccountName}</p>
              </>
            ) : (
              <p className="text-xs text-amber-600">No bank details on file</p>
            )}
            {pay.status === "PAID" && (
              <p className="mt-1 text-xs text-[#22264B]/60">
                Paid {formatDateTime(pay.paidAt)} via {pay.paymentMethod?.toLowerCase().replace("_", " ")}
                {pay.paymentReference ? ` · ref ${pay.paymentReference}` : ""}{paidByName ? ` · by ${paidByName}` : ""}
              </p>
            )}
          </div>
        </div>

        {/* Breakdown */}
        <div className="grid grid-cols-2 gap-6 py-4">
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Earnings</p>
            <table className="w-full text-sm">
              <tbody>
                {shownEarnings.map(([label, v]) => (
                  <tr key={label} className="border-b border-[#22264B]/5">
                    <td className="py-1.5 text-[#22264B]/75">{label}</td>
                    <td className="py-1.5 text-right font-medium">{formatMoney(v)}</td>
                  </tr>
                ))}
                <tr className="font-bold text-[#22264B]">
                  <td className="py-2">Gross pay</td>
                  <td className="py-2 text-right">{formatMoney(pay.grossPay)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <p className="mb-2 text-[10px] font-bold tracking-widest text-[#22264B]/45 uppercase">Deductions</p>
            <table className="w-full text-sm">
              <tbody>
                {shownDeductions.map(([label, v]) => (
                  <tr key={label} className="border-b border-[#22264B]/5">
                    <td className="py-1.5 text-[#22264B]/75">{label}</td>
                    <td className="py-1.5 text-right font-medium text-red-600">−{formatMoney(v)}</td>
                  </tr>
                ))}
                {loanDeductions.map((l) => (
                  <tr key={l.id} className="text-xs text-[#22264B]/50">
                    <td className="py-1 pl-3">↳ {l.loanRef}</td>
                    <td className="py-1 text-right">−{formatMoney(l.amount)}</td>
                  </tr>
                ))}
                {shownDeductions.length === 0 && (
                  <tr><td className="py-1.5 text-[#22264B]/50" colSpan={2}>No deductions</td></tr>
                )}
                <tr className="font-bold text-[#22264B]">
                  <td className="py-2">Total deductions</td>
                  <td className="py-2 text-right text-red-600">−{formatMoney(pay.totalDeductions)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Net pay */}
        <div className="flex items-center justify-between rounded-lg bg-[#22264B] px-5 py-4 text-white">
          <span className="text-sm font-bold tracking-widest uppercase">Net pay</span>
          <span className="text-2xl font-black text-[#F7A026]">{formatMoney(pay.netPay)}</span>
        </div>

        {pay.notes && <p className="mt-3 text-xs whitespace-pre-line text-[#22264B]/55">{pay.notes}</p>}

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-xs text-[#22264B]/60">
          <div className="border-t border-[#22264B]/30 pt-2 text-center">Staff signature & date</div>
          <div className="border-t border-[#22264B]/30 pt-2 text-center">Authorised by (management)</div>
        </div>

        <p className="mt-6 text-center text-[10px] text-[#22264B]/40">
          Generated by {businessName} payroll · {pay.reference} · {period}
        </p>
      </div>

      <style>{`@media print { body { background: white; } @page { margin: 12mm; } }`}</style>
    </div>
  );
}
