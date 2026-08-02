import { useState } from "react";
import { Loader2 } from "lucide-react";
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
 * Full company/customer profile: identity & registration, contact people,
 * addresses and financial terms. Credit limit is only editable with the
 * credit.manage permission — the backend enforces the same rule.
 */

export interface EditableCustomer {
  id: number;
  fullName: string;
  customerType: "INDIVIDUAL" | "BUSINESS";
  businessName: string | null;
  contactPerson: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  website: string | null;
  tin: string | null;
  rcNumber: string | null;
  address: string | null;
  deliveryAddress: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  notes: string | null;
  creditLimit: number;
}

interface Props {
  /** undefined = closed, null = create, object = edit */
  customer: EditableCustomer | null | undefined;
  onClose: () => void;
}

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="col-span-full mt-1 border-b border-[#22264B]/10 pb-1 text-[11px] font-black tracking-[0.14em] text-[#22264B]/45 uppercase">
      {children}
    </p>
  );
}

export function CustomerFormDialog({ customer, onClose }: Props) {
  const open = customer !== undefined;
  const editing = customer ?? null;
  const { hasPermission } = useAuth();
  const canSetLimit = hasPermission("credit.manage");

  const [formKey, setFormKey] = useState("closed");
  const [customerType, setCustomerType] = useState<"INDIVIDUAL" | "BUSINESS">("BUSINESS");
  const [fullName, setFullName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [tin, setTin] = useState("");
  const [rcNumber, setRcNumber] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("Nigeria");
  const [notes, setNotes] = useState("");
  const [creditLimit, setCreditLimit] = useState("0");

  const sessionKey = open ? (editing ? `edit-${editing.id}` : "create") : "closed";
  if (sessionKey !== formKey) {
    setFormKey(sessionKey);
    setCustomerType(editing?.customerType ?? "BUSINESS");
    setFullName(editing?.fullName ?? "");
    setBusinessName(editing?.businessName ?? "");
    setContactPerson(editing?.contactPerson ?? "");
    setPhone(editing?.phone ?? "");
    setAltPhone(editing?.altPhone ?? "");
    setEmail(editing?.email ?? "");
    setWebsite(editing?.website ?? "");
    setTin(editing?.tin ?? "");
    setRcNumber(editing?.rcNumber ?? "");
    setAddress(editing?.address ?? "");
    setDeliveryAddress(editing?.deliveryAddress ?? "");
    setCity(editing?.city ?? "");
    setState(editing?.state ?? "");
    setCountry(editing?.country ?? "Nigeria");
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
      customerType,
      businessName: businessName.trim(),
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      altPhone: altPhone.trim(),
      email: email.trim(),
      website: website.trim(),
      tin: tin.trim(),
      rcNumber: rcNumber.trim(),
      address: address.trim(),
      deliveryAddress: deliveryAddress.trim(),
      city: city.trim(),
      state: state.trim(),
      country: country.trim(),
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#22264B]">
            {editing ? `Edit ${editing.fullName}` : "New Customer"}
          </DialogTitle>
          <DialogDescription>
            Full customer profile — used on receipts, credit checks and delivery records.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[62vh] grid-cols-1 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
          <SectionTitle>Account type</SectionTitle>
          <div className="col-span-full grid grid-cols-2 gap-2">
            {(["BUSINESS", "INDIVIDUAL"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setCustomerType(t)}
                className={`rounded-lg border px-3 py-2 text-left transition ${
                  customerType === t ? "border-[#F7A026] bg-[#F7A026]/10" : "border-[#22264B]/10 hover:border-[#F7A026]/50"
                }`}
              >
                <span className="block text-sm font-bold text-[#22264B]">
                  {t === "BUSINESS" ? "Business / Company" : "Individual"}
                </span>
                <span className="block text-xs text-[#22264B]/50">
                  {t === "BUSINESS" ? "Registered company, shop or distributor" : "Person buying for themselves"}
                </span>
              </button>
            ))}
          </div>

          <SectionTitle>{customerType === "BUSINESS" ? "Company details" : "Customer details"}</SectionTitle>
          <div className="space-y-1.5">
            <Label>{customerType === "BUSINESS" ? "Contact person / owner name *" : "Full name *"}</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Musa Abdullahi" />
          </div>
          {customerType === "BUSINESS" && (
            <div className="space-y-1.5">
              <Label>Business name</Label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Musa & Sons Ventures" />
            </div>
          )}
          {customerType === "BUSINESS" && (
            <>
              <div className="space-y-1.5">
                <Label>RC number (CAC)</Label>
                <Input value={rcNumber} onChange={(e) => setRcNumber(e.target.value)} placeholder="e.g. RC1234567" />
              </div>
              <div className="space-y-1.5">
                <Label>Tax ID (TIN)</Label>
                <Input value={tin} onChange={(e) => setTin(e.target.value)} placeholder="e.g. 12345678-0001" />
              </div>
            </>
          )}

          <SectionTitle>Contact</SectionTitle>
          {customerType === "BUSINESS" && (
            <div className="space-y-1.5">
              <Label>Alternative contact person</Label>
              <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} placeholder="e.g. store manager" />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0803 000 0000" />
          </div>
          <div className="space-y-1.5">
            <Label>Alternative phone</Label>
            <Input value={altPhone} onChange={(e) => setAltPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {customerType === "BUSINESS" && (
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="e.g. www.example.com" />
            </div>
          )}

          <SectionTitle>Addresses</SectionTitle>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Address</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street / area" />
          </div>
          <div className="space-y-1.5">
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Kano" />
          </div>
          <div className="space-y-1.5">
            <Label>State</Label>
            <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="e.g. Kano State" />
          </div>
          <div className="space-y-1.5">
            <Label>Country</Label>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Delivery address (if different)</Label>
            <Input value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} placeholder="Where goods should be delivered" />
          </div>

          <SectionTitle>Financial & notes</SectionTitle>
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
              <p className="text-xs text-[#22264B]/45">0 = customer must always pay in full. Changes may need approval.</p>
            )}
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Anything worth remembering about this customer…" />
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
            {pending && <Loader2 className="mr-1 size-4 animate-spin" />}
            {pending ? "Saving…" : editing ? "Save Changes" : "Create Customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
