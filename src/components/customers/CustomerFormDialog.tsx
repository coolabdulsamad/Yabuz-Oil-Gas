import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
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

/**
 * YABUZ OIL & GAS — customer create/edit form.
 * Credit limit is only editable with the credit.manage permission —
 * the backend enforces the same rule.
 */

export interface EditableCustomer {
  id: number;
  fullName: string;
  businessName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  creditLimit: number;
}

interface Props {
  /** undefined = closed, null = create, object = edit */
  customer: EditableCustomer | null | undefined;
  onClose: () => void;
}

export function CustomerFormDialog({ customer, onClose }: Props) {
  const open = customer !== undefined;
  const editing = customer ?? null;
  const { hasPermission } = useAuth();
  const canSetLimit = hasPermission("credit.manage");

  const [formKey, setFormKey] = useState("closed");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [creditLimit, setCreditLimit] = useState("0");

  const sessionKey = open ? (editing ? `edit-${editing.id}` : "create") : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setFullName(editing?.fullName ?? "");
    setBusinessName(editing?.businessName ?? "");
    setPhone(editing?.phone ?? "");
    setEmail(editing?.email ?? "");
    setAddress(editing?.address ?? "");
    setNotes(editing?.notes ?? "");
    setCreditLimit(String(editing?.creditLimit ?? 0));
  }

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.customers.list.invalidate();
    utils.customers.creditOverview.invalidate();
  };

  const create = trpc.customers.create.useMutation({
    onSuccess: (r) => {
      toast.success(`Customer created — ${r.code}.`);
      invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.customers.update.useMutation({
    onSuccess: () => {
      toast.success("Customer updated.");
      invalidate();
      if (editing) utils.customers.getById.invalidate({ id: editing.id });
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const pending = create.isPending || update.isPending;
  const limitNum = Number(creditLimit);
  const valid = fullName.trim().length >= 2 && Number.isFinite(limitNum) && limitNum >= 0;

  const submit = () => {
    if (!valid) return;
    const data = {
      fullName: fullName.trim(),
      businessName: businessName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      notes: notes.trim(),
      creditLimit: canSetLimit ? limitNum : (editing?.creditLimit ?? 0),
    };
    if (editing) {
      update.mutate({ id: editing.id, data });
    } else {
      create.mutate(data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">
            {editing ? `Edit ${editing.fullName}` : "New Customer"}
          </DialogTitle>
          <DialogDescription>
            Customer account for sales, credit tracking and advance deposits.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Full name *</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Musa Abdullahi" />
          </div>
          <div className="space-y-1.5">
            <Label>Business name</Label>
            <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Musa & Sons Ventures" />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0803 000 0000" />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Credit limit (₦)</Label>
            <Input
              type="number"
              min="0"
              step="any"
              value={creditLimit}
              onChange={(e) => setCreditLimit(e.target.value)}
              disabled={!canSetLimit}
            />
            {!canSetLimit && (
              <p className="text-xs text-[#22264B]/45">
                Only staff with the "Manage credit limits" permission can change this.
              </p>
            )}
            {canSetLimit && (
              <p className="text-xs text-[#22264B]/45">0 = customer must always pay in full.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={!valid || pending}
            className="bg-[#22264B] text-white hover:bg-[#22264B]/90"
          >
            {pending ? "Saving…" : editing ? "Save Changes" : "Create Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
