import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
 *   DEPOSIT → record an advance deposit into the customer's wallet
 *   REFUND  → pay deposit money back out
 *   LIMIT   → change the credit limit (reason mandatory, audited)
 *   ADJUST  → manual correction of outstanding credit (audited)
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
  DEPOSIT: { title: "Record Advance Deposit", cta: "Add to wallet" },
  REFUND: { title: "Refund Deposit", cta: "Pay out refund" },
  LIMIT: { title: "Change Credit Limit", cta: "Update limit" },
  ADJUST: { title: "Adjust Outstanding Credit", cta: "Apply adjustment" },
};

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

  const sessionKey = open ? `${mode}-${customer?.id}` : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setAmount("");
    setReason("");
    setDirection("DECREASE");
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
  };

  const onSuccess = (msg: string) => {
    toast.success(msg);
    invalidate();
    onClose();
  };
  const onError = (e: { message: string }) => toast.error(e.message);

  const deposit = trpc.customers.recordDeposit.useMutation({
    onSuccess: (r) => onSuccess(`Deposit recorded — wallet now ${formatMoney(r.depositBalanceAfter)}.`),
    onError,
  });
  const refund = trpc.customers.refundDeposit.useMutation({
    onSuccess: (r) => onSuccess(`Refund paid — wallet now ${formatMoney(r.depositBalanceAfter)}.`),
    onError,
  });
  const setLimit = trpc.customers.setCreditLimit.useMutation({
    onSuccess: () => onSuccess("Credit limit updated."),
    onError,
  });
  const adjust = trpc.customers.adjustCredit.useMutation({
    onSuccess: (r) => onSuccess(`Adjusted — outstanding now ${formatMoney(r.creditBalanceAfter)}.`),
    onError,
  });

  const pending = deposit.isPending || refund.isPending || setLimit.isPending || adjust.isPending;
  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum > 0;

  const valid = (() => {
    if (!mode || !customer) return false;
    if (mode === "DEPOSIT") return amountValid;
    if (mode === "REFUND") return amountValid && reason.trim().length >= 3;
    if (mode === "LIMIT") return Number.isFinite(amountNum) && amountNum >= 0 && reason.trim().length >= 3;
    return amountValid && reason.trim().length >= 3;
  })();

  const submit = () => {
    if (!valid || !mode || !customer) return;
    if (mode === "DEPOSIT") {
      deposit.mutate({ customerId: customer.id, amount: amountNum, notes: reason.trim() });
    } else if (mode === "REFUND") {
      refund.mutate({ customerId: customer.id, amount: amountNum, reason: reason.trim() });
    } else if (mode === "LIMIT") {
      setLimit.mutate({ customerId: customer.id, creditLimit: amountNum, reason: reason.trim() });
    } else {
      adjust.mutate({ customerId: customer.id, direction, amount: amountNum, reason: reason.trim() });
    }
  };

  const text = mode ? MODE_TEXT[mode] : MODE_TEXT.DEPOSIT;
  const amountLabel =
    mode === "LIMIT" ? "New credit limit (₦)" : "Amount (₦)";
  const reasonLabel =
    mode === "DEPOSIT" ? "Notes (optional)" : "Reason *";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
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

          <div className="space-y-1.5">
            <Label>{reasonLabel}</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "REFUND"
                  ? "e.g. Customer requested cash back"
                  : mode === "LIMIT"
                    ? "e.g. 6 months of good repayment history"
                    : mode === "ADJUST"
                      ? "e.g. Correcting double-charged invoice"
                      : "e.g. Bank transfer received"
              }
            />
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
            {pending ? "Saving…" : text.cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
