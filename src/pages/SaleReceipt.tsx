import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { ArrowLeft, Printer } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { formatDateTime, formatMoney, formatQty } from "@/lib/format";
import { PAYMENT_MODE_LABELS } from "@/pages/Sales";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * YABUZ OIL & GAS — printable sales receipt / invoice.
 * Standalone page (no app shell) opened from the sale detail once a sale is
 * COMPLETED. Print styles strip the toolbar and tighten margins for A5/A4.
 */

export default function SaleReceipt() {
  const { id } = useParams();
  const saleId = Number(id);
  const { isAuthenticated, isLoading: authLoading } = useAuth({ redirectOnUnauthenticated: true });

  const query = trpc.sales.getById.useQuery({ id: saleId }, { enabled: isAuthenticated });
  const identityQ = trpc.settings.businessIdentity.useQuery(undefined, { enabled: isAuthenticated });

  const data = query.data;
  const identity = (identityQ.data ?? {}) as Record<string, unknown>;
  const businessName = typeof identity["business.name"] === "string" ? (identity["business.name"] as string) : "Yabuz Oil & Gas Ltd";
  const businessAddress = typeof identity["business.address"] === "string" ? (identity["business.address"] as string) : "";
  const businessPhone = typeof identity["business.phone"] === "string" ? (identity["business.phone"] as string) : "";
  const businessEmail = typeof identity["business.email"] === "string" ? (identity["business.email"] as string) : "";
  const rcNumber = typeof identity["business.rc_number"] === "string" ? (identity["business.rc_number"] as string) : "";
  const tagline = typeof identity["business.tagline"] === "string" ? (identity["business.tagline"] as string) : "";
  const footer = typeof identity["business.receipt_footer"] === "string" ? (identity["business.receipt_footer"] as string) : "Thank you for your patronage!";

  const printable = data?.sale.status === "COMPLETED";

  useEffect(() => {
    document.title = printable && data ? `Receipt ${data.sale.orderNo}` : "Sales Receipt";
  }, [printable, data]);

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
        <p className="text-sm text-[#22264B]/60">Sale not found.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link to="/sales">Back to sales</Link>
        </Button>
      </div>
    );
  }

  const { sale, items, customer, repName, approverName } = data;

  if (!printable) {
    return (
      <div className="py-24 text-center">
        <p className="text-base font-bold text-[#22264B]">Receipt not available yet</p>
        <p className="mt-1 text-sm text-[#22264B]/60">
          A receipt can only be generated after the sale is fully approved and completed.
          Current status: {sale.status}.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link to={`/sales/${sale.id}`}>
            <ArrowLeft className="size-4" /> Back to sale
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5FA] py-6 print:bg-white print:py-0">
      {/* Toolbar — hidden in print */}
      <div className="no-print mx-auto mb-4 flex max-w-3xl items-center justify-between px-4">
        <Button asChild variant="outline" size="sm">
          <Link to={`/sales/${sale.id}`}>
            <ArrowLeft className="size-4" /> Back to sale
          </Link>
        </Button>
        <Button onClick={() => window.print()} className="bg-[#22264B] text-white hover:bg-[#22264B]/90" size="sm">
          <Printer className="size-4" /> Print / Save PDF
        </Button>
      </div>

      {/* Receipt sheet */}
      <div className="mx-auto max-w-3xl bg-white p-8 shadow-md print:max-w-none print:p-6 print:shadow-none">
        {/* Header */}
        <div className="flex items-start justify-between border-b-2 border-[#22264B] pb-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#22264B]">{businessName}</h1>
            {tagline && <p className="text-xs text-[#22264B]/60 italic">{tagline}</p>}
            <div className="mt-2 space-y-0.5 text-xs text-[#22264B]/70">
              {businessAddress && <p>{businessAddress}</p>}
              <p>
                {[businessPhone && `Tel: ${businessPhone}`, businessEmail].filter(Boolean).join(" · ")}
              </p>
              {rcNumber && <p>RC: {rcNumber}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-lg font-black tracking-widest text-[#F7A026] uppercase">Sales Receipt</p>
            <p className="mt-1 text-sm font-bold text-[#22264B]">{sale.orderNo}</p>
            <p className="text-xs text-[#22264B]/60">{formatDateTime(sale.completedAt ?? sale.createdAt)}</p>
          </div>
        </div>

        {/* Parties */}
        <div className="grid grid-cols-2 gap-6 border-b border-[#22264B]/15 py-4 text-sm">
          <div>
            <p className="text-[10px] font-black tracking-widest text-[#22264B]/45 uppercase">Sold to</p>
            <p className="mt-1 font-bold text-[#22264B]">
              {customer ? (customer.businessName ?? customer.fullName) : "Walk-in customer"}
            </p>
            {customer?.businessName && <p className="text-xs text-[#22264B]/70">{customer.fullName}</p>}
            {customer && <p className="text-xs text-[#22264B]/60">Customer code: {customer.code}</p>}
            {customer?.phone && <p className="text-xs text-[#22264B]/60">{customer.phone}</p>}
            {customer?.address && (
              <p className="text-xs text-[#22264B]/60">
                {[customer.address, customer.city, customer.state].filter(Boolean).join(", ")}
              </p>
            )}
            {customer?.tin && <p className="text-xs text-[#22264B]/60">TIN: {customer.tin}</p>}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black tracking-widest text-[#22264B]/45 uppercase">Sale details</p>
            <p className="mt-1 text-xs text-[#22264B]/70">Sold by: {repName}</p>
            {approverName && <p className="text-xs text-[#22264B]/70">Approved by: {approverName}</p>}
            <p className="text-xs text-[#22264B]/70">Settlement: {PAYMENT_MODE_LABELS[sale.paymentMode] ?? sale.paymentMode}</p>
            <p className="text-xs font-bold text-[#22264B]">Payment status: {sale.paymentStatus}</p>
          </div>
        </div>

        {/* Items */}
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-[#22264B] text-left text-[10px] font-black tracking-widest text-[#22264B]/50 uppercase">
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">Item</th>
              <th className="py-2 pr-2">Sold as</th>
              <th className="py-2 pr-2 text-right">Qty</th>
              <th className="py-2 pr-2 text-right">Unit price</th>
              <th className="py-2 pr-2 text-right">Discount</th>
              <th className="py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={i.id} className="border-b border-[#22264B]/10">
                <td className="py-2 pr-2 text-[#22264B]/50">{idx + 1}</td>
                <td className="py-2 pr-2">
                  <span className="block font-semibold text-[#22264B]">{i.productName}</span>
                  <span className="block text-xs text-[#22264B]/50">{i.sku} · {i.packDescription}</span>
                </td>
                <td className="py-2 pr-2 text-xs text-[#22264B]/70">{i.soldAsUnits ? "Inner units" : "Whole packs"}</td>
                <td className="py-2 pr-2 text-right">{formatQty(i.quantity)}</td>
                <td className="py-2 pr-2 text-right">{formatMoney(i.unitPrice)}</td>
                <td className="py-2 pr-2 text-right">{i.discountAmount > 0 ? `−${formatMoney(i.discountAmount)}` : "—"}</td>
                <td className="py-2 text-right font-bold text-[#22264B]">{formatMoney(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-[#22264B]/60">Subtotal</span>
              <span className="font-semibold text-[#22264B]">{formatMoney(sale.subtotal)}</span>
            </div>
            {sale.discountTotal > 0 && (
              <div className="flex justify-between">
                <span className="text-[#22264B]/60">Discount{sale.discountNote ? ` (${sale.discountNote})` : ""}</span>
                <span className="font-semibold text-red-600">−{formatMoney(sale.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between border-t-2 border-[#22264B] pt-2">
              <span className="font-black text-[#22264B]">Total</span>
              <span className="text-lg font-black text-[#F7A026]">{formatMoney(sale.grandTotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#22264B]/60">Amount paid</span>
              <span className="font-semibold text-emerald-700">{formatMoney(sale.amountPaid)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#22264B]/60">Balance</span>
              <span className={`font-semibold ${sale.balanceDue > 0 ? "text-red-600" : "text-[#22264B]"}`}>
                {formatMoney(sale.balanceDue)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes + footer */}
        {sale.notes && sale.notes.replace(/\[mode:[A-Z_]+\]\s?/, "").trim() && (
          <div className="mt-6 border-t border-[#22264B]/15 pt-3 text-xs text-[#22264B]/70">
            <span className="font-bold text-[#22264B]">Notes: </span>
            {sale.notes.replace(/\[mode:[A-Z_]+\]\s?/, "")}
          </div>
        )}
        <div className="mt-8 border-t border-[#22264B]/15 pt-4 text-center">
          <p className="text-sm font-bold text-[#22264B]">{footer}</p>
          <p className="mt-1 text-[10px] text-[#22264B]/45">
            Generated {formatDateTime(new Date())} · {businessName} — powered by Yabuz Business Suite
          </p>
        </div>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 12mm; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  );
}
