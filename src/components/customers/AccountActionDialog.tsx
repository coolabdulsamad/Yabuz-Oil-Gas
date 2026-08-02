import { useState } from "react";
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
 * YABUZ OIL & GAS — customer account actions.
 * One dialog, four modes:
 *   DEPOSIT → record an advance deposit (full payment details + proof + approval)
 *   REFUND  → pay deposit money back out (full payment details + proof + approval)
 *   LIMIT   → change the credit limit (reason mandatory; CUSTOMER_CREDIT approval chain)
 *   ADJUST  → manual correction of outstanding credit (audited)
 * Money modes create a real payment record — nothing touches a wallet
 * until the payment clears its approval chain.
 */

export type AccountActionMode = "DEPOSIT" | "REFUND" | "LIMIT" | "ADJUST";

interface CustomerLite {
  id: number;
  fullName: string;
  creditLimit: number;
  creditOutstanding: number;
  depositBalance: number;
}

const MODE_TEXT: Record<AccountActionMode, { title: string; cta: string }> = {
  DEPOSIT: { title: "Record Advance Deposit", cta: "Submit deposit" },
  REFUND: { title: "Refund Deposit", cta: "Submit refund" },
  LIMIT: { title: "Change Credit Limit", cta: "Update limit" },
  ADJUST: { title: "Adjust Outstanding Credit", cta: "Apply adjustment" },
};

const METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "BANK_TRANSFER", label: "Bank transfer" },
  { value: "POS", label: "POS" },
  { value: "CHEQUE", label: "Cheque" },
] as const;

interface Props {
  mode: AccountActionMode | null;
  customer: CustomerLite | null;
  onClose: () => void;
}

export function AccountActionDialog({ mode, customer, onClose }: Props) {
  const open = mode !== null && customer !== null;
  const [formKey, setFormKey] = useState("closed");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [direction, setDirection] = useState<"INCREASE" | "DECREASE">("DECREASE");
  const [method, setMethod] = useState<(typeof METHODS)[number]["value"]>("BANK_TRANSFER");
  const [externalReference, setExternalReference] = useState("");
  const [proof, setProof] = useState<ProofValue | null>(null);

  const isMoneyMode = mode === "DEPOSIT" || mode === "REFUND";

  const sessionKey = open ? `${mode}-${customer?.id}` : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setAmount("");
    setReason("");
    setDirection("DECREASE");
    setMethod("BANK_TRANSFER");
    setExternalReference("");
    setProof(null);
  }

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.customers.list.invalidate();
    if (customer) {
      utils.customers.getById.invalidate({ id: customer.id });
      utils.customers.ledger.invalidate();
    }
    utils.customers.creditOverview.invalidate();
    utils.customers.depositsOverview.invalidate();
    utils.customers.accountCounts.invalidate();
    utils.payments.list.invalidate();
    utils.approvals.pendingForMe.invalidate();
  };

  const onError = (e: { message: string }) => toast.error(e.message);

  const deposit = trpc.customers.recordDeposit.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.outcome === "CONFIRMED"
          ? `Deposit ${r.reference} confirmed — wallet updated.`
          : `Deposit ${r.reference} submitted — waiting for approval before it counts.`,
      );
      invalidate();
      onClose();
    },
    onError,
  });
  const refund = trpc.customers.refundDeposit.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.outcome === "CONFIRMED"
          ? `Refund ${r.reference} confirmed — wallet updated.`
          : `Refund ${r.reference} submitted — waiting for approval.`,
      );
      invalidate();
      onClose();
    },
    onError,
  });
  const setLimit = trpc.customers.setCreditLimit.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.outcome === "PENDING"
          ? "Credit-limit change submitted — it applies after final approval."
          : "Credit limit updated.",
      );
      invalidate();
      onClose();
    },
    onError,
  });
  const adjust = trpc.customers.adjustCredit.useMutation({
    onSuccess: (r) => {
      toast.success(`Adjusted — outstanding now ${formatMoney(r.creditBalanceAfter)}.`);
      invalidate();
      onClose();
    },
    onError,
  });

  const pending = deposit.isPending || refund.isPending || setLimit.isPending || adjust.isPending;
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;
  const proofOk = method === "CASH" || proof !== null;

  const valid = (() => {
    if (!mode || !customer) return false;
    if (mode === "DEPOSIT") return amountValid && proofOk;
    if (mode === "REFUND") return amountValid && proofOk && reason.trim().length >= 3;
    if (mode === "LIMIT") return Number.isFinite(amountNum) && amountNum >= 0 && reason.trim().length >= 3;
    return amountValid && reason.trim().length >= 3;
  })();

  const submit = () => {
    if (!valid || !mode || !customer) return;
    if (mode === "DEPOSIT") {
      deposit.mutate({
        customerId: customer.id,
        amount: amountNum,
        method,
        externalReference: externalReference.trim() || undefined,
        proofUrl: proof?.url,
        proofPublicId: proof?.publicId,
        notes: reason.trim(),
      });
    } else if (mode === "REFUND") {
      refund.mutate({
        customerId: customer.id,
        amount: amountNum,
        method,
        externalReference: externalReference.trim() || undefined,
        proofUrl: proof?.url,
        proofPublicId: proof?.publicId,
        reason: reason.trim(),
      });
    } else if (mode === "LIMIT") {
      setLimit.mutate({ customerId: customer.id, creditLimit: amountNum, reason: reason.trim() });
    } else {
      adjust.mutate({ customerId: customer.id, direction, amount: amountNum, reason: reason.trim() });
    }
  };

  const text = mode ? MODE_TEXT[mode] : MODE_TEXT.DEPOSIT;
  const amountLabel = mode === "LIMIT" ? "New credit limit (₦)" : "Amount (₦)";
  const reasonLabel =
    mode === "DEPOSIT" ? "Notes (optional)" : mode === "REFUND" ? "Reason *" : "Reason *";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">{text.title}</DialogTitle>
          <DialogDescription>{customer?.fullName}</DialogDescription>
        </DialogHeader>

        {customer && (
          <div className="rounded-lg bg-[#22264B]/[0.04] px-3 py-2 text-xs text-[#22264B]/70">
            Outstanding: <span className="font-bold">{formatMoney(customer.creditOutstanding)}</span>
            {" · "}Limit: <span className="font-bold">{formatMoney(customer.creditLimit)}</span>
            {" · "}Deposit wallet: <span className="font-bold">{formatMoney(customer.depositBalance)}</span>
          </div>
        )}

        {isMoneyMode && (
          <p className="rounded-lg border border-[#F7A026]/30 bg-[#F7A026]/10 px-3 py-2 text-xs text-[#9a6212]">
            This goes through the approval chain with full payment details and proof — the wallet
            only moves after final approval.
          </p>
        )}

        <div className="space-y-4">
          {mode === "ADJUST" && (
            <div className="space-y-1.5">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as typeof direction)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DECREASE">Decrease what they owe (−)</SelectItem>
                  <SelectItem value="INCREASE">Increase what they owe (+)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {isMoneyMode && (
            <div className="space-y-1.5">
              <Label>{mode === "DEPOSIT" ? "Payment method *" : "Payout method *"}</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{amountLabel}</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50000"
            />
            {mode === "REFUND" && customer && amountValid && amountNum > customer.depositBalance && (
              <p className="text-xs text-red-600">
                More than the wallet holds ({formatMoney(customer.depositBalance)}).
              </p>
            )}
          </div>

          {isMoneyMode && method !== "CASH" && (
            <div className="space-y-1.5">
              <Label>{method === "CHEQUE" ? "Cheque no." : "Transfer / POS reference"}</Label>
              <Input
                value={externalReference}
                onChange={(e) => setExternalReference(e.target.value)}
                placeholder="e.g. bank session ID, POS terminal ref"
              />
            </div>
          )}

          {isMoneyMode && (
            <div className="space-y-1.5">
              <Label>Proof of {mode === "DEPOSIT" ? "payment" : "payout"}</Label>
              <ProofUpload value={proof} onChange={(v) => setProof(v)} required={method !== "CASH"} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>{reasonLabel}</Label>
            {isMoneyMode ? (
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder={
                  mode === "REFUND"
                    ? "e.g. Customer requested cash back — paid via transfer"
                    : "e.g. Bank transfer received from customer"
                }
              />
            ) : (
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  mode === "LIMIT"
                    ? "e.g. 6 months of good repayment history"
                    : "e.g. Correcting double-charged invoice"
                }
              />
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || pending || (mode === "REFUND" && customer !== null && amountNum > customer.depositBalance)}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {pending && <Loader2 className="mr-1 size-4 animate-spin" />}
            {pending ? "Saving…" : text.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
