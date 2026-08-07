import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { formatMoney } from "@/lib/format";
import { ProofUpload, type ProofValue } from "@/components/payments/ProofUpload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * YABUZ OIL & GAS — record a payment (any of the four types).
 * Proof upload is optional for every method; overpayment on a sale flows
 * into the customer's deposit wallet at confirmation.
 */

type PaymentType = "SALE_PAYMENT" | "CREDIT_PAYMENT" | "ADVANCE_DEPOSIT" | "DEPOSIT_REFUND";

const TYPE_OPTIONS: { value: PaymentType; label: string; hint: string }[] = [
  { value: "SALE_PAYMENT", label: "Sale payment", hint: "Settle a specific sale's balance" },
  { value: "CREDIT_PAYMENT", label: "Credit repayment", hint: "Pay down what a customer owes" },
  { value: "ADVANCE_DEPOSIT", label: "Advance deposit", hint: "Customer leaves money with us" },
  { value: "DEPOSIT_REFUND", label: "Deposit refund", hint: "Return deposit money to customer" },
];

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "POS", label: "POS" },
  { value: "CHEQUE", label: "Cheque" },
] as const;

export function RecordPaymentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [formKey, setFormKey] = useState(0);
  const [paymentType, setPaymentType] = useState<PaymentType>("SALE_PAYMENT");
  const [saleId, setSaleId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("BANK_TRANSFER");
  const [amount, setAmount] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [proof, setProof] = useState<ProofValue | null>(null);
  const [notes, setNotes] = useState("");

  // Reset the form each time the dialog opens.
  const sessionKey = open ? 1 : 0;
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    if (open) {
      setPaymentType("SALE_PAYMENT");
      setSaleId("");
      setCustomerId("");
      setMethod("BANK_TRANSFER");
      setAmount("");
      setExternalReference("");
      setProof(null);
      setNotes("");
    }
  }

  const customersQuery = trpc.customers.list.useQuery({ status: "ACTIVE" }, { enabled: open });
  const unpaidQuery = trpc.payments.unpaidSales.useQuery(undefined, { enabled: open && paymentType === "SALE_PAYMENT" });

  const selectedSale = useMemo(
    () => (unpaidQuery.data ?? []).find((s) => String(s.id) === saleId) ?? null,
    [unpaidQuery.data, saleId],
  );
  const selectedCustomer = useMemo(
    () => (customersQuery.data ?? []).find((c) => String(c.id) === customerId) ?? null,
    [customersQuery.data, customerId],
  );

  // Prefill amount from the selected sale / customer context.
  useEffect(() => {
    if (paymentType === "SALE_PAYMENT" && selectedSale) {
      setAmount(String(selectedSale.balanceDue));
      if (selectedSale.customerId) setCustomerId(String(selectedSale.customerId));
    }
  }, [paymentType, selectedSale]);

  const createMutation = trpc.payments.create.useMutation({
    onSuccess: async (r) => {
      toast.success(r.outcome === "CONFIRMED" ? "Payment confirmed." : "Payment recorded — waiting for approval.");
      await utils.payments.list.invalidate();
      await utils.payments.unpaidSales.invalidate();
      await utils.sales.list.invalidate();
      await utils.customers.creditOverview.invalidate();
      await utils.customers.depositsOverview.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Enter a valid amount.");
      return;
    }
    if (paymentType === "SALE_PAYMENT" && !saleId) {
      toast.error("Pick the sale this payment settles.");
      return;
    }
    if (paymentType !== "SALE_PAYMENT" && !customerId) {
      toast.error("Pick a customer.");
      return;
    }
    // Proof is optional for all methods.
    createMutation.mutate({
      paymentType,
      saleId: paymentType === "SALE_PAYMENT" ? Number(saleId) : undefined,
      customerId: customerId ? Number(customerId) : undefined,
      method,
      amount: amt,
      proofUrl: proof?.url,
      proofPublicId: proof?.publicId,
      externalReference: externalReference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>Money in (or a refund out) — it goes through the approval chain before it counts.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-bold tracking-widest text-[#22264B]/50 uppercase">Payment type</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {TYPE_OPTIONS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setPaymentType(t.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    paymentType === t.value ? "border-[#F7A026] bg-[#F7A026]/10" : "border-[#22264B]/10 hover:border-[#F7A026]/50"
                  }`}
                >
                  <span className="block text-sm font-bold text-[#22264B]">{t.label}</span>
                  <span className="block text-xs text-[#22264B]/50">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {paymentType === "SALE_PAYMENT" ? (
            <div>
              <Label>Sale to settle</Label>
              <Select value={saleId} onValueChange={setSaleId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder={unpaidQuery.isLoading ? "Loading unpaid sales…" : "Pick a sale…"} />
                </SelectTrigger>
                <SelectContent>
                  {(unpaidQuery.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.orderNo} · {s.customerName ?? "Walk-in"} · balance {formatMoney(s.balanceDue)}
                    </SelectItem>
                  ))}
                  {(unpaidQuery.data ?? []).length === 0 && !unpaidQuery.isLoading && (
                    <div className="px-3 py-2 text-sm text-[#22264B]/50">No unpaid sales right now.</div>
                  )}
                </SelectContent>
              </Select>
              {selectedSale && (
                <p className="mt-1.5 rounded-lg bg-[#22264B]/[0.04] px-3 py-2 text-xs text-[#22264B]/70">
                  {selectedSale.orderNo}: total {formatMoney(selectedSale.grandTotal)}, outstanding{" "}
                  <strong>{formatMoney(selectedSale.balanceDue)}</strong>
                  {selectedSale.paymentMode === "CREDIT" && " · credit sale — confirming also clears the customer's debt"}
                  . Pay above the balance and the excess lands in the customer's deposit wallet.
                </p>
              )}
            </div>
          ) : (
            <div>
              <Label>Customer</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Pick a customer…" />
                </SelectTrigger>
                <SelectContent>
                  {(customersQuery.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.fullName} · {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedCustomer && paymentType === "CREDIT_PAYMENT" && (
                <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Outstanding: {formatMoney(selectedCustomer.creditOutstanding)}
                </p>
              )}
              {selectedCustomer && paymentType === "DEPOSIT_REFUND" && (
                <p className="mt-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                  Deposit balance: {formatMoney(selectedCustomer.depositBalance)}
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount (₦)</Label>
              <Input type="number" min={0} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5" />
            </div>
          </div>

          {method !== "CASH" && (
            <div>
              <Label>{method === "CHEQUE" ? "Cheque no." : "Transfer / POS reference"}</Label>
              <Input value={externalReference} onChange={(e) => setExternalReference(e.target.value)} className="mt-1.5" placeholder="Optional external reference" />
            </div>
          )}

          <div>
            <Label className="mb-1.5 block">Proof of payment (optional)</Label>
            <ProofUpload value={proof} onChange={(v) => setProof(v)} />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5 min-h-16" placeholder="Optional notes…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            className="bg-[#F7A026] font-bold text-[#22264B] hover:bg-[#e0901c]"
            disabled={createMutation.isPending}
            onClick={submit}
          >
            {createMutation.isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
